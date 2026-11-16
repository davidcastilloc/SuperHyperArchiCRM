import {
  autoBusinessRules,
  commThreadsAndMessages,
  createD1Client,
  docAttachments,
  kernelAiProposals,
} from '@shac/db-d1';

export const SVG_SIG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><path d="M2 10 L70 10"/></svg>';

export async function seedPhase7Fixture(rawDb: D1Database, nowSec: number): Promise<void> {
  await rawDb
    .prepare(
      `INSERT OR IGNORE INTO crm_parties (id, tenant_id, org_id, party_kind, display_name, legal_name, tax_id_type, tax_id_number, is_active, created_at, updated_at)
       VALUES ('pty_p7_1', 'ten_1', 'org_1', 'person', 'Elena Rios', 'Elena Rios', 'V', '33445566', 1, ?, ?)`,
    )
    .bind(nowSec, nowSec)
    .run();

  const db = createD1Client(rawDb);
  await db.batch([
    db.insert(docAttachments).values([
      {
        id: 'att_p7_pub',
        tenantId: 'ten_1',
        orgId: 'org_1',
        entityType: 'work_order',
        recordId: 'wo_p7_seed',
        partyId: 'pty_p7_1',
        fileName: 'invoice-public.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        r2ObjectKey: 'r2/public.pdf',
        sha256Hash: 'hash_pub',
        isConfidential: false,
        uploadedByUserId: 'usr_p7_1',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'att_p7_priv',
        tenantId: 'ten_1',
        orgId: 'org_1',
        entityType: 'clinical_note',
        recordId: 'cn_p7_seed',
        partyId: 'pty_p7_1',
        fileName: 'phi-secret.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048,
        r2ObjectKey: 'r2/secret.pdf',
        sha256Hash: 'hash_priv',
        isConfidential: true,
        uploadedByUserId: 'usr_p7_1',
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(commThreadsAndMessages).values([
      {
        id: 'msg_p7_pub',
        tenantId: 'ten_1',
        orgId: 'org_1',
        partyId: 'pty_p7_1',
        subject: 'Cita confirmada',
        senderId: 'usr_p7_1',
        body: 'Su cita fue confirmada.',
        isConfidential: false,
        sentAt: nowSec,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      {
        id: 'msg_p7_priv',
        tenantId: 'ten_1',
        orgId: 'org_1',
        partyId: 'pty_p7_1',
        subject: 'Nota interna PHI',
        senderId: 'usr_p7_1',
        body: 'Confidencial medico',
        isConfidential: true,
        sentAt: nowSec,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
    ]),
    db.insert(autoBusinessRules).values({
      id: 'rule_p7_1',
      tenantId: 'ten_1',
      orgId: 'org_1',
      ruleCode: 'WO_URGENT_NOTIFY',
      name: 'Notificar orden urgente',
      ruleKind: 'ACTION',
      entityType: 'work_order',
      lifecycleEvent: 'on_create',
      priority: 10,
      conditionAstJson: JSON.stringify({ field: 'priority', op: 'eq', value: 'URGENT' }),
      actionsJson: JSON.stringify([{ type: 'notify', channel: 'ops' }]),
      isEnabled: true,
      createdAt: nowSec,
      updatedAt: nowSec,
    }),
    db.insert(kernelAiProposals).values({
      id: 'prop_p7_1',
      tenantId: 'ten_1',
      orgId: 'org_1',
      ownerUserId: 'usr_p7_1',
      agentId: 'inbox-ops',
      modelId: 'gemini-4-hydrogen-medium',
      targetCommandId: 'services.work_orders.upsert',
      targetRecordId: 'wo_p7_1',
      proposedDiffJson: JSON.stringify({ priority: 'URGENT' }),
      createdAt: nowSec,
      updatedAt: nowSec,
    }),
  ]);
}
