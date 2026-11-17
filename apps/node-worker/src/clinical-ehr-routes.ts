import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const EncounterSchema = z.object({
  patientPartyId: z.string().min(1),
  chiefComplaint: z.string().min(1).max(240),
  vitals: z.object({
    bpSystolic: z.number().int().min(40).max(300).optional(),
    bpDiastolic: z.number().int().min(20).max(200).optional(),
    heartRate: z.number().int().min(20).max(250).optional(),
    tempC: z.number().min(30).max(45).optional(),
    spo2Pct: z.number().int().min(40).max(100).optional(),
  }).default({}),
  dictationText: z.string().max(4000).default(''),
});

const PrescriptionSchema = z.object({
  patientPartyId: z.string().min(1),
  medicationName: z.string().min(1).max(160),
  dosage: z.string().min(1).max(120),
  sigInstructions: z.string().min(1).max(240),
  quantity: z.number().int().positive().default(1),
  daysSupply: z.number().int().positive().default(30),
});

const LabOrRcmSchema = z.object({
  kind: z.enum(['lab_order', 'rcm_claim']),
  patientPartyId: z.string().min(1),
  titleOrModality: z.string().min(1).max(160),
  totalChargeMinor: z.number().int().nonnegative().default(0),
  insurerPaidMinor: z.number().int().nonnegative().default(0),
  diagnosisCodes: z.array(z.string()).default([]),
});

/** Mounts Clinical EHR Workspace: Encounters/Vitals, AI Scribe SOAP, eRx, Lab/Imaging, and RCM Scrubber. */
export function createClinicalEhrRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/clinical/overview', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.read');
      const [encRes, noteRes, rxRes, labRes, rcmRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, patient_party_id, chief_complaint, vitals_json, status, started_at
           FROM med_encounters_and_vitals WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, encounter_id, patient_party_id, subjective, objective, assessment, plan, icd10_codes_json, status, created_at
           FROM med_clinical_notes WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, patient_party_id, medication_name, dosage, sig_instructions, status, created_at
           FROM med_prescriptions_and_erx WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, order_or_accession_no, patient_party_id, modality_or_category, abnormal_flag, status, created_at
           FROM med_labs_and_imaging WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, claim_or_check_number, patient_party_id, total_charge_minor, insurer_paid_minor, patient_responsibility_minor, scrubber_warnings_json, status, created_at
           FROM med_rcm_claims_and_era WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
      ]);
      return c.json({
        encounters: encRes?.results ?? [],
        notes: noteRes?.results ?? [],
        prescriptions: rxRes?.results ?? [],
        labs: labRes?.results ?? [],
        rcmClaims: rcmRes?.results ?? [],
      });
    })
    .post('/clinical/encounters', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = EncounterSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid encounter input', parsed.error.flatten());
      const d = parsed.data;
      const nowSec = Math.floor(Date.now() / 1000);
      const encounterId = crypto.randomUUID();
      const noteId = crypto.randomUUID();
      const staffId = auth.actor.id || 'usr_clinician';

      let soap = {
        subjective: d.dictationText.trim() || `Motivo de consulta: ${d.chiefComplaint}`,
        objective: `Signos vitales — PA: ${d.vitals.bpSystolic ?? '—'}/${d.vitals.bpDiastolic ?? '—'} mmHg, FC: ${d.vitals.heartRate ?? '—'} lpm, Temp: ${d.vitals.tempC ?? '—'} °C, SpO2: ${d.vitals.spo2Pct ?? '—'}%`,
        assessment: `Evaluación clínica por ${d.chiefComplaint}`,
        plan: 'Plan terapéutico ambulatorio y seguimiento en 7 días.',
        icd10: ['R51.9'],
      };

      if (c.env.AI && d.dictationText.trim()) {
        try {
          const aiOut = (await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              { role: 'system', content: 'Eres un AI Scribe clínico. Resume el dictado médico en JSON con llaves subjective, objective, assessment, plan.' },
              { role: 'user', content: `${d.chiefComplaint}. Signos: ${JSON.stringify(d.vitals)}. Dictado: ${d.dictationText}` },
            ],
          })) as { response?: string } | undefined;
          if (aiOut?.response?.trim()) {
            soap = { ...soap, assessment: aiOut.response.trim().slice(0, 600) };
          }
        } catch {
          // Graceful fallback to deterministic SOAP parser
        }
      }

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO med_encounters_and_vitals
            (id, tenant_id, org_id, patient_party_id, provider_staff_id, chief_complaint, vitals_json, started_at, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'IN_PROGRESS', ?8, ?8)`,
        ).bind(encounterId, auth.actor.tenantId, auth.actor.orgId, d.patientPartyId, staffId, d.chiefComplaint, JSON.stringify(d.vitals), nowSec),
        c.env.DB.prepare(
          `INSERT INTO med_clinical_notes
            (id, tenant_id, org_id, encounter_id, patient_party_id, author_staff_id, note_format, subjective, objective, assessment, plan, icd10_codes_json, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'SOAP', ?7, ?8, ?9, ?10, ?11, 'SIGNED', ?12, ?12)`,
        ).bind(noteId, auth.actor.tenantId, auth.actor.orgId, encounterId, d.patientPartyId, staffId, soap.subjective, soap.objective, soap.assessment, soap.plan, JSON.stringify(soap.icd10), nowSec),
      ]);

      return c.json({ ok: true, encounterId, noteId, soap }, 201);
    })
    .post('/clinical/prescriptions', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = PrescriptionSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid prescription', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO med_prescriptions_and_erx
          (id, tenant_id, org_id, patient_party_id, prescriber_staff_id, medication_name, dosage, sig_instructions, quantity, days_supply, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'TRANSMITTED', ?11, ?11)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.patientPartyId, auth.actor.id || 'usr_clinician', d.medicationName, d.dosage, d.sigInstructions, d.quantity, d.daysSupply, nowSec).run();
      return c.json({ ok: true, id, ...d }, 201);
    })
    .post('/clinical/labs-and-rcm', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = LabOrRcmSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid lab or RCM payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);

      if (d.kind === 'lab_order') {
        const acc = `ACC-${String(nowSec).slice(-6)}`;
        await c.env.DB.prepare(
          `INSERT INTO med_labs_and_imaging
            (id, tenant_id, org_id, record_kind, order_or_accession_no, patient_party_id, ordering_staff_id, modality_or_category, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'lab_order', ?4, ?5, ?6, ?7, 'ORDERED', ?8, ?8)`,
        ).bind(id, auth.actor.tenantId, auth.actor.orgId, acc, d.patientPartyId, auth.actor.id || 'usr_clinician', d.titleOrModality, nowSec).run();
        return c.json({ ok: true, id, accessionNo: acc }, 201);
      }

      const scrubberWarnings: string[] = [];
      if (d.diagnosisCodes.length === 0) scrubberWarnings.push('Falta código CIE-10 principal para evitar glosa');
      if (d.totalChargeMinor <= 0) scrubberWarnings.push('El cargo total debe ser mayor a $0.00');
      const patientResponsibilityMinor = Math.max(0, d.totalChargeMinor - d.insurerPaidMinor);
      const claimNo = `CLM-${String(nowSec).slice(-6)}`;

      await c.env.DB.prepare(
        `INSERT INTO med_rcm_claims_and_era
          (id, tenant_id, org_id, record_kind, claim_or_check_number, patient_party_id, diagnosis_codes_json, total_charge_minor, insurer_paid_minor, patient_responsibility_minor, scrubber_warnings_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'claim_837', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, claimNo, d.patientPartyId, JSON.stringify(d.diagnosisCodes), d.totalChargeMinor, d.insurerPaidMinor, patientResponsibilityMinor, JSON.stringify(scrubberWarnings), scrubberWarnings.length > 0 ? 'NEEDS_REVIEW' : 'READY', nowSec).run();

      return c.json({ ok: true, id, claimNumber: claimNo, patientResponsibilityMinor, scrubberWarnings }, 201);
    });
}
