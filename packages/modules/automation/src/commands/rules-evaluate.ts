import { autoBusinessRules, type ShacD1Database } from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  parseJsonArray,
  parseJsonRecord,
  resolveScopedTargetOrg,
} from '../lib/scope-helpers.js';
import { evaluateConditionAst } from '../rule-evaluator.js';

const evaluateRulesInputSchema = z.object({
  orgId: z.string().min(1).optional(),
  entityType: z.string().min(1),
  lifecycleEvent: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});

const matchedRuleSchema = z.object({
  id: z.string(),
  ruleCode: z.string(),
  name: z.string(),
  ruleKind: z.string(),
  priority: z.number().int(),
  actions: z.array(z.unknown()),
});

const evaluateRulesOutputSchema = z.object({
  orgId: z.string(),
  entityType: z.string(),
  lifecycleEvent: z.string(),
  evaluatedCount: z.number().int(),
  matchedRules: z.array(matchedRuleSchema),
});

export const automationRulesEvaluateCommand = defineCommand<
  typeof evaluateRulesInputSchema,
  z.infer<typeof evaluateRulesOutputSchema>,
  ShacD1Database
>({
  id: 'automation.rules.evaluate',
  moduleId: 'automation',
  method: 'POST',
  path: '/api/automation/rules/evaluate',
  summary:
    'Evaluate enabled business rules for an entity lifecycle event against a payload',
  requiredPermission: 'automation.rules.evaluate',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description:
      'Evaluate active auto_business_rules for (entityType, lifecycleEvent) in priority order',
  },
  inputSchema: evaluateRulesInputSchema,
  outputSchema: evaluateRulesOutputSchema,
  async handler(ctx, input) {
    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const rules = await ctx.db
      .select({
        id: autoBusinessRules.id,
        ruleCode: autoBusinessRules.ruleCode,
        name: autoBusinessRules.name,
        ruleKind: autoBusinessRules.ruleKind,
        priority: autoBusinessRules.priority,
        conditionAstJson: autoBusinessRules.conditionAstJson,
        actionsJson: autoBusinessRules.actionsJson,
      })
      .from(autoBusinessRules)
      .where(
        and(
          eq(autoBusinessRules.tenantId, ctx.tenantId),
          eq(autoBusinessRules.orgId, targetOrgId),
          eq(autoBusinessRules.entityType, input.entityType),
          eq(autoBusinessRules.lifecycleEvent, input.lifecycleEvent),
          eq(autoBusinessRules.isEnabled, true),
          isNull(autoBusinessRules.deletedAt),
        ),
      )
      .orderBy(asc(autoBusinessRules.priority));

    const matchedRules = rules
      .filter((rule) =>
        evaluateConditionAst(parseJsonRecord(rule.conditionAstJson), input.payload),
      )
      .map((rule) => ({
        id: rule.id,
        ruleCode: rule.ruleCode,
        name: rule.name,
        ruleKind: rule.ruleKind,
        priority: rule.priority,
        actions: parseJsonArray(rule.actionsJson),
      }));

    return {
      orgId: targetOrgId,
      entityType: input.entityType,
      lifecycleEvent: input.lifecycleEvent,
      evaluatedCount: rules.length,
      matchedRules,
    };
  },
});
