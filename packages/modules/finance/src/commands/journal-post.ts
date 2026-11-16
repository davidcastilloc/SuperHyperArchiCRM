import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  finJournalEntries,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  sumJournalLinesBigInt,
  toSafeNumberMinor,
} from '../lib/money-bigint.js';
import {
  parseJsonRecord,
  resolveScopedTargetOrg,
} from '../lib/scope-helpers.js';

const journalLineSchema = z.object({
  accountCode: z.string().min(1).max(64),
  accountId: z.string().min(1).optional(),
  debitMinor: z.number().int().nonnegative(),
  creditMinor: z.number().int().nonnegative(),
  memo: z.string().max(256).optional(),
});

const journalPostInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  entryNumber: z.string().min(1).max(64),
  entryDate: z.number().int().positive(),
  fiscalYear: z.number().int().min(1970).max(2100),
  fiscalPeriod: z.number().int().min(1).max(13),
  sourceModule: z.string().min(1).max(64).default('finance'),
  sourceRecordId: z.string().min(1).nullable().optional(),
  reference: z.string().max(128).nullable().optional(),
  description: z.string().min(1).max(500),
  lines: z.array(journalLineSchema).min(2),
  postedByUserId: z.string().min(1).nullable().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const journalPostOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  entryNumber: z.string(),
  entryDate: z.number().int(),
  fiscalYear: z.number().int(),
  fiscalPeriod: z.number().int(),
  sourceModule: z.string(),
  sourceRecordId: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string(),
  totalDebitMinor: z.number().int().positive(),
  totalCreditMinor: z.number().int().positive(),
  lineCount: z.number().int().min(2),
  status: z.string(),
  postedByUserId: z.string().nullable(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const financeJournalPostCommand = defineCommand<
  typeof journalPostInputSchema,
  z.infer<typeof journalPostOutputSchema>,
  ShacD1Database
>({
  id: 'finance.journal.post',
  moduleId: 'finance',
  method: 'POST',
  path: '/api/finance/journal/post',
  summary: 'Validate and post a balanced double-entry general ledger journal entry',
  requiredPermission: 'finance.journal.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Post a double-entry journal entry to fin_journal_entries; validates totalDebitMinor === totalCreditMinor in BigInt or rejects with 422 UNBALANCED_JOURNAL_ENTRY',
  },
  inputSchema: journalPostInputSchema,
  outputSchema: journalPostOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'finance.journal.post',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      journalPostOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const summary = sumJournalLinesBigInt(input.lines);
    if (!summary.isBalanced) {
      throw new AppError(
        'UNBALANCED_JOURNAL_ENTRY',
        422,
        'Journal entry debits and credits must balance and be strictly positive',
        {
          totalDebitMinor: summary.totalDebitMinor.toString(),
          totalCreditMinor: summary.totalCreditMinor.toString(),
        },
      );
    }

    const totalDebitMinor = toSafeNumberMinor(
      summary.totalDebitMinor,
      'totalDebitMinor',
    );
    const totalCreditMinor = toSafeNumberMinor(
      summary.totalCreditMinor,
      'totalCreditMinor',
    );

    const entryId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const customFieldsJson = JSON.stringify(input.customFields);

    const output: z.infer<typeof journalPostOutputSchema> = {
      id: entryId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      entryNumber: input.entryNumber,
      entryDate: input.entryDate,
      fiscalYear: input.fiscalYear,
      fiscalPeriod: input.fiscalPeriod,
      sourceModule: input.sourceModule,
      sourceRecordId: input.sourceRecordId ?? null,
      reference: input.reference ?? null,
      description: input.description,
      totalDebitMinor,
      totalCreditMinor,
      lineCount: input.lines.length,
      status: 'posted',
      postedByUserId: input.postedByUserId ?? ctx.actor.id,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };
    const responseJson = JSON.stringify(output);

    await ctx.db.batch([
      ctx.db.insert(finJournalEntries).values({
        id: entryId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        entryNumber: input.entryNumber,
        entryDate: input.entryDate,
        fiscalYear: input.fiscalYear,
        fiscalPeriod: input.fiscalPeriod,
        sourceModule: input.sourceModule,
        sourceRecordId: input.sourceRecordId ?? null,
        reference: input.reference ?? null,
        description: input.description,
        linesJson: JSON.stringify(input.lines),
        totalDebitMinor,
        totalCreditMinor,
        status: 'posted',
        postedByUserId: output.postedByUserId,
        customFields: customFieldsJson,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'finance.journal.post',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'finance.journal.post',
        resourceKind: 'fin_journal_entry',
        resourceId: entryId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return output;
  },
});
