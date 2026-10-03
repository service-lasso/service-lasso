# ADR-001: source-owned Windows/Linux release evidence

Date: 2026-10-04. Governing issue: #1619, parent #1613 / #1562.
Status: authored durable decision, awaiting distinct entire-source review and governed landing. Development, documentation only. Implementation and qualification remain pending.

## Decision and authority

The release owner's [dated instruction](../project/CURRENT_GA_PLATFORM_SCOPE.md) makes Windows/Linux the required platforms for this GA; Darwin is Deferred / Not applicable, never PASS. This decision chooses one immutable source-owned policy, versioned closed evidence, and distinct historical distribution dispatch. It introduces no shared runtime service or caller-selected eligibility. [SPEC-008](../specs/SPEC-008-two-os-release-evidence.md) is the normative implementation contract, mapped to SPEC-007 AC-7F/7G/7H.

The canonical policy is [ga-platform-scope.json](../project/ga-platform-scope.json). Its exact bytes, including the final LF, are hashed. Each source-approved policy reference binds repository, full commit, path, Git blob and SHA-256. The commit/blob are resolved from this actually landed policy, then separately source-approved in satellite references; no self-referential commit or invented digest is stored inside the policy. Publication never resolves mutable develop. The requirements revision anchors the already merged owner applicability source, rather than asserting this ADR was approved at that historical commit.

## Alternatives and tradeoffs

Deleting a matrix row leaves incompatible fixed schemas, inventories, selectors and aggregate contracts. Caller or environment platform lists permit downgrade. Reusing old evidence misstates candidate qualification. A shared policy service adds mutable infrastructure authority unnecessarily. Selected source-owned policy copies/references and new closed schemas preserve historical contracts and fail closed when migration is incomplete. Wrapping unchanged qualification bodies avoids changing private custody and runtime API meanings, at the cost of explicit dual dispatch and reader-first rollout.

## Whole-chain implementation decision

SPEC-008 fixes all public/retained schema versions and keys, target names, canonical inventory order, workflow selectors and migration denial tests. Producer identity binds policy before build; aggregate admits all and only required target jobs from one SHA/run/attempt/policy; publisher retains held verified bytes through private draft and immutable public readback. Core admission requires separately source-approved actual publication tuples including scope digest. Retained archive/npm tools and final published qualification prove those identical bytes. Empty approved catalogs remain empty during contract implementation.

The CLI's actual inner Windows native archive remains TAR in the scoped protected-v2 contract. This is eligibility plumbing, not satisfaction of the literal CLI #30 Windows ZIP programme requirement. That obligation remains UNMET and blocking for Windows GA until an independently reviewed producer/consumer ZIP design and real Windows producer/consumer acceptance discharge it. Core's outer Windows ZIP is a separate obligation and cannot substitute. Windows ZIP must not disappear through Darwin exclusion or a renamed requirement. Source authority: CLI SPEC-CLI-PROTECTED-NATIVE-CANDIDATE issue30 continuation explicitly says Windows ZIP separately UNMET; preserved Core #1602 author closure records that distinction. A later CLI ZIP inventory change requires another closed schema version and reconciled consumer, counts, native proof and pins, rather than extras or silent TAR substitution.

Existing Admin/Broker source-owned release policies retain their real independently pinned distribution inventories. Integration eligibility does not mutate historical published assets. Any producer change requires its own actual current-source inspection, qualified publication and separate catalog approval.

## Migration and rollback

1. Land this independently reviewed durable decision and matching satellite spec mappings before product code.
2. Land Core readers/dispatch and producer-owned CLI/TUI/template contract units from their own current develop, each with complete final source/dependency review and NEW complete-input admission before execution. New route stays unavailable until all contracts match.
3. Obtain real Windows/Linux native/operator/template proof, protected immutable publication and same-byte public readback; independently review a pins-only Core admission change with actual IDs, sizes and digests.
4. Acquire original bytes, package without rebuilding tools, verify published npm and terminal native/operator qualification; owner alone records exact-candidate GA and separately authorizes promotion/publication/deployment.

Rollback disables the new source-selected route and retains all immutable assets, failures and receipts. Historical distribution may continue under exact original catalog identities. Never retag, edit immutable releases, splice older Darwin assets, relax catalog emptiness or upgrade historical evidence into new GA proof. Future platform addition requires new policy/candidate/evidence and review.

## Readiness and normative origin

Windows/Linux cleanup EBUSY, native/operator/runtime failures, normal input namespace/materialization/source preservation, native observer/compiler/fixture ownership, private custody/credentials/provider controls, empty tool/template catalogs and absent actual publication remain unresolved. Darwin-only helper/grant obligations are deferred; shared dependencies remain required. All original deadlines, ownership, non-destructive local-input promises, private/public separation and first-failure rules survive. Guaranteed finite physical syscalls on arbitrary filesystems and zero OS read-access metadata changes were stronger agent/parent proposals, not original human requirements; separate input architecture must disposition its own actual contract.

No product execution or release proof is established here. The reviewed source-only blueprint SHA-256 is 037AA66DF728486E6019470BC3851F38F9EB0F3668B9E2EEB88635A8B0DCB328; independent entire blueprint report SHA-256 is 317D2707DEA52E138B35ED3F59BEF7B211F776EEBF91BA423C7D82873E68EDDB. Their C1-C5 conditions become SPEC-008 R1-R7, not an extra owner permission gate. Final durable source still requires its own distinct entire review.
