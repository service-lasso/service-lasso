export type SecurityPermissionMarker = "dangerous" | "elevated" | "recovery" | "read-only";

export type SecurityPermissionCatalogueEntry = {
  key: string;
  label: string;
  description: string;
  markers: SecurityPermissionMarker[];
};

export type AccessGroupKind = "built-in" | "custom";

export type AccessGroup = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  kind: AccessGroupKind;
  permissions: string[];
  scopeRules: AccessGroupScopeRule[];
  requiredForRecovery: boolean;
  resettable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AccessGroupScopeRule = {
  type: "runtime" | "workspace" | "service" | "file-source" | "provider" | "schedule";
  id: string | "*";
};

export type SecurityActorKind =
  | "local-root"
  | "local-token"
  | "service-account"
  | "provider-identity";

export type SecurityActorAssignment = {
  id: string;
  workspaceId: string;
  actor: {
    kind: SecurityActorKind;
    id: string;
  };
  groupId: string;
  source: "bootstrap" | "operator" | "provider-mapping";
  createdAt: string;
  createdBy: string;
};

export type ProviderClaimType = "group" | "role" | "org" | "service-account" | (string & {});

export type ProviderGroupMapping = {
  id: string;
  workspaceId: string;
  provider: string;
  claimType: ProviderClaimType;
  claimValue: string;
  targetGroupId: string;
  createdAt: string;
  createdBy: string;
};

export type SecurityAuditEvent = {
  id: string;
  workspaceId: string;
  action: string;
  actorId: string;
  targetId: string;
  outcome: "success" | "denied";
  reason: string | null;
  at: string;
};

export type SecurityModelState = {
  workspaceId: string;
  permissionCatalogue: SecurityPermissionCatalogueEntry[];
  accessGroups: AccessGroup[];
  actorAssignments: SecurityActorAssignment[];
  providerMappings: ProviderGroupMapping[];
  audit: SecurityAuditEvent[];
};

export type CustomAccessGroupRequest = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  scopeRules?: AccessGroupScopeRule[];
  createdBy: string;
  now?: string;
};

export type ProviderClaimResolutionInput = {
  workspaceId: string;
  provider: string;
  claims: Partial<Record<ProviderClaimType, string[]>>;
};

export type AssignmentRemovalDecision =
  | {
      ok: true;
      state: SecurityModelState;
      auditEvent: SecurityAuditEvent;
    }
  | {
      ok: false;
      state: SecurityModelState;
      reason: "last-owner-protection" | "assignment-not-found";
      auditEvent: SecurityAuditEvent;
    };

export const serviceLassoPermissionCatalogue = [
  permission("workspace:read", "Workspace visibility", "Read runtime, service, and workspace metadata.", ["read-only"]),
  permission("security:manage", "Security administration", "Manage users, groups, mappings, local tokens, provider auth, and security settings.", ["elevated", "recovery"]),
  permission("audit:read", "Audit visibility", "Read security and runtime audit metadata.", ["read-only"]),
  permission("service:install", "Service install", "Install or import services into a workspace.", ["elevated"]),
  permission("service:configure", "Service configuration", "Change service configuration through Service Lasso.", ["elevated"]),
  permission("service:start", "Service start", "Start managed services.", []),
  permission("service:stop", "Service stop", "Stop managed services.", []),
  permission("service:restart", "Service restart", "Restart managed services.", []),
  permission("service:update", "Service update", "Update managed services.", ["elevated"]),
  permission("service:diagnose", "Service diagnostics", "Run diagnostics and health checks.", []),
  permission("backup:create", "Backup creation", "Create workspace or service backups.", ["elevated"]),
  permission("backup:read", "Backup history", "Read backup history metadata.", ["read-only"]),
  permission("backup:restore", "Backup restore", "Restore backups after confirmation.", ["dangerous", "elevated"]),
  permission("files:browse", "File browsing", "Browse approved service file sources.", ["read-only"]),
  permission("files:archive", "File archive", "Archive approved file selections.", ["elevated"]),
  permission("files:export", "File export", "Export approved file archives.", ["elevated"]),
  permission("schedule:run", "Scheduled actions", "Run approved scheduled actions.", []),
  permission("broker:resolve-scoped", "Scoped broker access", "Resolve scoped service or broker references without broader admin rights.", ["elevated"]),
] as const satisfies SecurityPermissionCatalogueEntry[];

export const builtInAccessGroupTemplates = [
  groupTemplate("owner", "Owner", "Full workspace ownership and final recovery authority.", ["*"], true),
  groupTemplate("security-admin", "Security Admin", "Manage users, groups, mappings, local tokens, provider auth, audit, and security settings.", ["workspace:read", "security:manage", "audit:read"], true),
  groupTemplate("service-admin", "Service Admin", "Install, configure, start, stop, restart, update, and diagnose services.", ["workspace:read", "service:install", "service:configure", "service:start", "service:stop", "service:restart", "service:update", "service:diagnose"], false),
  groupTemplate("operator", "Operator", "Operate and diagnose already configured services.", ["workspace:read", "service:start", "service:stop", "service:restart", "service:diagnose"], false),
  groupTemplate("viewer", "Viewer", "Read-only runtime and service visibility.", ["workspace:read", "audit:read"], false),
  groupTemplate("backup-operator", "Backup Operator", "Create backups and inspect backup history.", ["workspace:read", "backup:create", "backup:read"], false),
  groupTemplate("restore-operator", "Restore Operator", "Restore backups with elevated confirmation.", ["workspace:read", "backup:read", "backup:restore"], false),
  groupTemplate("file-export-operator", "File Export Operator", "Browse, archive, and export approved file selections.", ["workspace:read", "files:browse", "files:archive", "files:export"], false),
  groupTemplate("scheduler", "Scheduler", "Run approved scheduled actions only.", ["workspace:read", "schedule:run"], false),
  groupTemplate("service-identity", "Service Identity", "Resolve scoped service and broker references without interactive user rights.", ["broker:resolve-scoped"], false),
] as const;

export function seedSecurityModel(
  workspaceId: string,
  localRootActorId: string,
  now = "2026-05-08T10:00:00Z",
): SecurityModelState {
  const accessGroups = builtInAccessGroupTemplates.map((template) => ({
    ...template,
    id: `${workspaceId}:${template.id}`,
    workspaceId,
    scopeRules: [{ type: "workspace", id: workspaceId }] as AccessGroupScopeRule[],
    createdAt: now,
    updatedAt: now,
  }));

  const ownerGroup = accessGroups.find((group) => group.name === "Owner");
  if (!ownerGroup) {
    throw new Error("Built-in Owner group is required.");
  }

  return {
    workspaceId,
    permissionCatalogue: [...serviceLassoPermissionCatalogue],
    accessGroups,
    actorAssignments: [
      {
        id: `${workspaceId}:assignment:local-root-owner`,
        workspaceId,
        actor: { kind: "local-root", id: localRootActorId },
        groupId: ownerGroup.id,
        source: "bootstrap",
        createdAt: now,
        createdBy: "bootstrap",
      },
    ],
    providerMappings: [],
    audit: [
      auditEvent(workspaceId, "security.bootstrap", "bootstrap", ownerGroup.id, "success", null, now),
    ],
  };
}

export function createCustomAccessGroup(
  state: SecurityModelState,
  request: CustomAccessGroupRequest,
): SecurityModelState {
  const now = request.now ?? "2026-05-08T11:00:00Z";
  const knownPermissions = new Set(state.permissionCatalogue.map((entry) => entry.key));
  const unknownPermissions = request.permissions.filter((entry) => !knownPermissions.has(entry));
  if (unknownPermissions.length > 0) {
    throw new Error(`Unknown Service Lasso permission(s): ${unknownPermissions.join(", ")}`);
  }
  if (state.accessGroups.some((group) => group.id === request.id || group.name === request.name)) {
    throw new Error(`Access group already exists: ${request.name}`);
  }

  const group: AccessGroup = {
    id: request.id,
    workspaceId: state.workspaceId,
    name: request.name,
    description: request.description,
    kind: "custom",
    permissions: uniqueStrings(request.permissions),
    scopeRules: request.scopeRules ?? [{ type: "workspace", id: state.workspaceId }],
    requiredForRecovery: false,
    resettable: false,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    accessGroups: [...state.accessGroups, group],
    audit: [
      ...state.audit,
      auditEvent(state.workspaceId, "security.group.create", request.createdBy, group.id, "success", null, now),
    ],
  };
}

export function createProviderGroupMapping(
  state: SecurityModelState,
  mapping: Omit<ProviderGroupMapping, "workspaceId" | "createdAt"> & { createdAt?: string },
): SecurityModelState {
  if (!state.accessGroups.some((group) => group.id === mapping.targetGroupId)) {
    throw new Error(`Unknown target access group: ${mapping.targetGroupId}`);
  }
  const createdAt = mapping.createdAt ?? "2026-05-08T11:00:00Z";
  return {
    ...state,
    providerMappings: [
      ...state.providerMappings,
      {
        ...mapping,
        workspaceId: state.workspaceId,
        createdAt,
      },
    ],
    audit: [
      ...state.audit,
      auditEvent(state.workspaceId, "security.provider-mapping.create", mapping.createdBy, mapping.id, "success", null, createdAt),
    ],
  };
}

export function resolveProviderMappedAccessGroups(
  state: SecurityModelState,
  input: ProviderClaimResolutionInput,
): AccessGroup[] {
  if (input.workspaceId !== state.workspaceId) {
    return [];
  }

  const matchedGroupIds = new Set<string>();
  for (const mapping of state.providerMappings) {
    if (mapping.provider !== input.provider || mapping.workspaceId !== input.workspaceId) {
      continue;
    }
    if ((input.claims[mapping.claimType] ?? []).includes(mapping.claimValue)) {
      matchedGroupIds.add(mapping.targetGroupId);
    }
  }

  return state.accessGroups.filter((group) => matchedGroupIds.has(group.id));
}

export function removeActorAssignment(
  state: SecurityModelState,
  assignmentId: string,
  actorId: string,
  now = "2026-05-08T11:00:00Z",
): AssignmentRemovalDecision {
  const assignment = state.actorAssignments.find((candidate) => candidate.id === assignmentId);
  if (!assignment) {
    return {
      ok: false,
      state,
      reason: "assignment-not-found",
      auditEvent: auditEvent(state.workspaceId, "security.assignment.remove", actorId, assignmentId, "denied", "assignment-not-found", now),
    };
  }

  const ownerGroupIds = ownerCapableGroupIds(state);
  if (ownerGroupIds.has(assignment.groupId)) {
    const remainingOwnerAssignments = state.actorAssignments.filter(
      (candidate) => candidate.id !== assignmentId && ownerGroupIds.has(candidate.groupId),
    );
    if (remainingOwnerAssignments.length === 0) {
      return {
        ok: false,
        state,
        reason: "last-owner-protection",
        auditEvent: auditEvent(state.workspaceId, "security.assignment.remove", actorId, assignmentId, "denied", "last-owner-protection", now),
      };
    }
  }

  const audit = auditEvent(state.workspaceId, "security.assignment.remove", actorId, assignmentId, "success", null, now);
  return {
    ok: true,
    state: {
      ...state,
      actorAssignments: state.actorAssignments.filter((candidate) => candidate.id !== assignmentId),
      audit: [...state.audit, audit],
    },
    auditEvent: audit,
  };
}

function ownerCapableGroupIds(state: SecurityModelState): Set<string> {
  return new Set(
    state.accessGroups
      .filter((group) => group.requiredForRecovery || group.permissions.includes("*") || group.permissions.includes("security:manage"))
      .map((group) => group.id),
  );
}

function permission(
  key: string,
  label: string,
  description: string,
  markers: SecurityPermissionMarker[],
): SecurityPermissionCatalogueEntry {
  return { key, label, description, markers };
}

function groupTemplate(
  id: string,
  name: string,
  description: string,
  permissions: string[],
  requiredForRecovery: boolean,
): Omit<AccessGroup, "id" | "workspaceId" | "scopeRules" | "createdAt" | "updatedAt"> & { id: string } {
  return {
    id,
    name,
    description,
    kind: "built-in",
    permissions,
    requiredForRecovery,
    resettable: true,
  };
}

function auditEvent(
  workspaceId: string,
  action: string,
  actorId: string,
  targetId: string,
  outcome: SecurityAuditEvent["outcome"],
  reason: string | null,
  at: string,
): SecurityAuditEvent {
  return {
    id: `audit_${action.replace(/[^a-z0-9]+/gi, "_")}_${Date.parse(at)}`,
    workspaceId,
    action,
    actorId,
    targetId,
    outcome,
    reason,
    at,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
