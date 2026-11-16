import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  medTherapyGroupsAndAba,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  buildPartyScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';

const abaTrialInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  recordKind: z
    .enum([
      'therapy_group',
      'group_session_attendance',
      'aba_data_session',
      'aba_trial',
      'aba_abc_behavior',
      'digital_homework',
      'assessment_scale',
    ])
    .default('aba_trial'),
  groupOrSessionId: z.string().min(1).nullable().optional(),
  patientPartyId: z.string().min(1),
  therapistStaffId: z.string().min(1).optional(),
  titleOrBehavior: z.string().min(1).max(500),
  antecedent: z.string().max(2000).nullable().optional(),
  consequence: z.string().max(2000).nullable().optional(),
  promptLevel: z.string().max(120).nullable().optional(),
  isCorrectTrial: z.boolean().nullable().optional(),
  score: z.number().int().nullable().optional(),
  severityLevel: z.string().max(80).nullable().optional(),
  durationSec: z.number().int().nonnegative().default(0),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.number().int().positive().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const abaTrialOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  recordKind: z.string(),
  groupOrSessionId: z.string().nullable(),
  patientPartyId: z.string(),
  therapistStaffId: z.string(),
  titleOrBehavior: z.string(),
  isCorrectTrial: z.boolean().nullable(),
  score: z.number().int().nullable(),
  durationSec: z.number().int().nonnegative(),
  occurredAt: z.number().int(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const casesMedAbaTrialCommand = defineCommand<
  typeof abaTrialInputSchema,
  z.infer<typeof abaTrialOutputSchema>,
  ShacD1Database
>({
  id: 'cases.med.aba_trial',
  moduleId: 'cases',
  method: 'POST',
  path: '/api/cases/med/aba-trials',
  summary: 'Record an ABA trial, ABC behavior observation, or therapy group session entry',
  requiredPermission: 'cases.med.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Record an ABA trial or therapy session entry in med_therapy_groups_and_aba',
  },
  inputSchema: abaTrialInputSchema,
  outputSchema: abaTrialOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'cases.med.aba_trial',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      abaTrialOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const partyRows = await buildPartyScopeQuery(ctx.db, input.patientPartyId);
    verifyScopedRow(ctx, partyRows[0], 'Patient party');

    const recordId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const occurredAt = input.occurredAt ?? nowSec;
    const therapistStaffId = input.therapistStaffId ?? ctx.actor.id;
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof abaTrialOutputSchema> = {
      id: recordId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      recordKind: input.recordKind,
      groupOrSessionId: input.groupOrSessionId ?? null,
      patientPartyId: input.patientPartyId,
      therapistStaffId,
      titleOrBehavior: input.titleOrBehavior,
      isCorrectTrial: input.isCorrectTrial ?? null,
      score: input.score ?? null,
      durationSec: input.durationSec,
      occurredAt,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };
    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(medTherapyGroupsAndAba).values({
        id: recordId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        recordKind: input.recordKind,
        groupOrSessionId: created.groupOrSessionId,
        patientPartyId: input.patientPartyId,
        therapistStaffId,
        titleOrBehavior: input.titleOrBehavior,
        antecedent: input.antecedent ?? null,
        consequence: input.consequence ?? null,
        promptLevel: input.promptLevel ?? null,
        isCorrectTrial: created.isCorrectTrial,
        score: created.score,
        severityLevel: input.severityLevel ?? null,
        durationSec: input.durationSec,
        payloadJson: JSON.stringify(input.payload),
        occurredAt,
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'cases.med.aba_trial',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'cases.med.aba_trial',
        resourceKind: 'med_aba_trial',
        resourceId: recordId,
        targetPartyId: input.patientPartyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});
