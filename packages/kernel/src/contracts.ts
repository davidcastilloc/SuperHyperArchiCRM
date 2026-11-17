import type { z } from 'zod';

export type EditionPresetId =
  | 'retail-pos'
  | 'distro-wms'
  | 'tech-service'
  | 'hospitality-pms'
  | 'property-condo'
  | 'clinic-practice'
  | 'legal-psa'
  | 'industrial-gate'
  | 'omni-enterprise';

export type RegionPackId = 've' | 'co' | 'mx' | 'us' | 'global';

export interface MarketVocabulary {
  partySingular: string;
  partyPlural: string;
  orderSingular: string;
  branchSingular: string;
  spaceSingular: string;
  caseSingular: string;
}

export interface CurrencyProfile {
  baseCurrency: string;
  operatingCurrencies: string[];
  rateSource: 'bcv' | 'central_bank' | 'manual';
  enforceAccountCurrencyMatch: boolean;
}

export interface TenantMarketProfile {
  deploymentId: string;
  tenantId: string;
  editionPreset: EditionPresetId;
  regionPack: RegionPackId;
  activeModules: string[];
  vocabulary: MarketVocabulary;
  currency: CurrencyProfile;
  entitlements: {
    maxBranches: number;
    maxPosRegisters: number;
    maxSpacesOrUnits: number;
    aiCopilotEnabled: boolean;
    customEntitiesLimit: number;
  };
  federation: {
    enabled: boolean;
    nodeDid: string;
    publishPublicCatalog: boolean;
    acceptPeerB2BOrders: boolean;
    consolidateLowStockHours: number;
    allowedSupplierDids: string[];
  };
  updatedAt: string;
}

export type ActorType =
  | 'staff'
  | 'delegated_staff'
  | 'api_key'
  | 'portal_user'
  | 'system';

export interface ExecutionActor {
  id: string;
  type: ActorType;
  perms: string[];
  delegatedById?: string;
}

export interface KvStore {
  get(key: string, type: 'text'): Promise<string | null>;
  put?(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface BranchActorStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface BranchActorResolver {
  getByBranchKey(key: string): BranchActorStub;
}

export interface ExecutionContext<TDb = unknown> {
  tenantId: string;
  orgId: string;
  orgPath: string;
  actor: ExecutionActor;
  profile: TenantMarketProfile;
  db: TDb;
  sessionKv?: KvStore;
  configKv?: KvStore;
  branchDo?: BranchActorResolver;
  requestId?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface McpCommandMetadata {
  expose: boolean;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  description?: string;
}

export interface CommandSpec<
  TIn extends z.ZodTypeAny = z.ZodTypeAny,
  TOut = unknown,
  TDb = unknown,
> {
  id: string;
  moduleId: string;
  method: HttpMethod;
  path: string;
  summary: string;
  requiredPermission: string;
  mcp: McpCommandMetadata;
  inputSchema: TIn;
  outputSchema: z.ZodType<TOut>;
  handler: (
    ctx: ExecutionContext<TDb>,
    input: z.infer<TIn>,
  ) => Promise<TOut>;
}

export interface ModuleManifest {
  id: string;
  version: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commands: readonly CommandSpec<any, any, any>[];
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: string,
    status: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function defineCommand<
  TIn extends z.ZodTypeAny,
  TOut,
  TDb = unknown,
>(spec: CommandSpec<TIn, TOut, TDb>): CommandSpec<TIn, TOut, TDb> {
  return spec;
}

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}

export interface McpToolMetadata {
  readonly description: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
}

export interface CommandDescriptor<TInput = unknown, TOutput = unknown, TContext = unknown> {
  readonly name: string;
  readonly moduleId: string;
  readonly summary?: string;
  readonly idempotent?: boolean;
  readonly requiredPermissions?: readonly string[];
  readonly mcpTool?: McpToolMetadata;
  readonly inputSchema?: { parse: (input: unknown) => TInput };
  readonly handler: (input: TInput, ctx: TContext) => Promise<TOutput>;
}

export interface CommandModuleManifest<TContext = unknown> {
  readonly moduleId: string;
  readonly version: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly commands: readonly CommandDescriptor<any, any, TContext>[];
}
