// AC-4DI.4 SOURCE ONLY. No initializer loads a library or acquires authority.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace ServiceLasso.SourceAcquisition
{
    internal sealed class Binding
    {
        internal readonly string Reference, Sha256;
        internal readonly long Length;
        internal Binding(string reference, long length, string sha256)
        {
            if (String.IsNullOrEmpty(reference) || length < 0 || sha256 == null ||
                sha256.Length != 64 || sha256.Any(c => !(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')))
                throw new ArgumentException("UNQUALIFIED_BINDING");
            Reference = reference; Length = length; Sha256 = sha256;
        }
        internal bool Matches(byte[] bytes)
        {
            if (bytes == null || bytes.LongLength != Length) return false;
            using (var sha = SHA256.Create())
                return Sha256 == BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
    }

    // These are structural input interfaces, never certificates of native/source authority.
    internal sealed class Origin
    {
        internal readonly Binding Source, Image, Constructor, Policy, Environment, Namespace;
        internal readonly string Symbol, BranchEvidence, ActorEvidence, ModuleEvidence;
        internal Origin(Binding source, Binding image, Binding constructor, Binding policy,
            Binding environment, Binding names, string symbol, string branch, string actor, string module)
        {
            Source = source; Image = image; Constructor = constructor; Policy = policy;
            Environment = environment; Namespace = names; Symbol = symbol;
            BranchEvidence = branch; ActorEvidence = actor; ModuleEvidence = module;
        }
        internal bool StructurallyComplete { get { return Source != null && Image != null &&
            Constructor != null && Policy != null && Environment != null && Namespace != null &&
            !String.IsNullOrEmpty(Symbol) && !String.IsNullOrEmpty(BranchEvidence) &&
            !String.IsNullOrEmpty(ActorEvidence) && !String.IsNullOrEmpty(ModuleEvidence); } }
    }
    internal sealed class Candidate
    {
        internal readonly int Index;
        internal readonly string Name, State, TopologyReference, HeldObjectReference, NegativeNameReference;
        internal readonly Binding Bytes;
        internal Candidate(int index, string name, string state, string topology, string held,
            string negative, Binding bytes)
        { Index = index; Name = name; State = state; TopologyReference = topology;
          HeldObjectReference = held; NegativeNameReference = negative; Bytes = bytes; }
    }
    internal sealed class Request
    {
        internal readonly Origin Origin;
        internal readonly string Family, Token, Api, Flags, Cwd, DynamicClosureReference, MutationBoundaryReference;
        internal readonly Candidate[] Candidates;
        internal Request(Origin origin, string family, string token, string api, string flags,
            string cwd, string dynamicClosure, string mutationBoundary, Candidate[] candidates)
        { Origin = origin; Family = family; Token = token; Api = api; Flags = flags; Cwd = cwd;
          DynamicClosureReference = dynamicClosure; MutationBoundaryReference = mutationBoundary;
          Candidates = candidates == null ? null : (Candidate[])candidates.Clone(); }
    }
    internal static class RequestGraph
    {
        internal static string Validate(Request[] requests, string[] requiredFamilies)
        {
            if (requests == null || requiredFamilies == null || requests.Length == 0 || requests.Length > 65536)
                return "UNQUALIFIED_REQUEST_GRAPH";
            var families = new HashSet<string>(StringComparer.Ordinal);
            long totalCandidates = 0;
            foreach (var request in requests)
            {
                if (request == null || request.Origin == null || !request.Origin.StructurallyComplete ||
                    String.IsNullOrEmpty(request.Family) || String.IsNullOrEmpty(request.Token) ||
                    String.IsNullOrEmpty(request.Api) || request.Flags == null || String.IsNullOrEmpty(request.Cwd) ||
                    String.IsNullOrEmpty(request.DynamicClosureReference) || String.IsNullOrEmpty(request.MutationBoundaryReference) ||
                    request.Candidates == null || request.Candidates.Length == 0 || request.Candidates.Length > 65536)
                    return "UNQUALIFIED_ORIGIN_OR_DYNAMIC_NAMESPACE";
                totalCandidates += request.Candidates.Length;
                if (totalCandidates > 500000) return "REQUEST_CANDIDATE_QUOTA";
                families.Add(request.Family);
                bool selected = false;
                for (int i = 0; i < request.Candidates.Length; i++)
                {
                    var candidate = request.Candidates[i];
                    if (candidate == null || candidate.Index != i || String.IsNullOrEmpty(candidate.Name) ||
                        String.IsNullOrEmpty(candidate.TopologyReference)) return "UNQUALIFIED_ORDERED_CANDIDATE";
                    if (candidate.State == "ABSENT")
                    { if (String.IsNullOrEmpty(candidate.NegativeNameReference) || candidate.Bytes != null)
                          return "UNQUALIFIED_NEGATIVE_NAME"; }
                    else if (candidate.State == "SELECTED" || candidate.State == "SHADOW" || candidate.State == "SUPPORT")
                    {
                        if (candidate.Bytes == null || String.IsNullOrEmpty(candidate.HeldObjectReference))
                            return "UNQUALIFIED_REACHABLE_BYTES";
                        if (candidate.State == "SELECTED") { if (selected) return "AMBIGUOUS_SELECTED_CANDIDATE"; selected = true; }
                    }
                    else return "UNKNOWN_CANDIDATE_STATE";
                }
                if (!selected) return "NO_POSITIVE_ORIGINAL_ROUTE";
            }
            if (requiredFamilies.Any(f => String.IsNullOrEmpty(f) || !families.Contains(f)))
                return "MISSING_REQUEST_FAMILY";
            // Structural correspondence only. The independent original authority must enforce it.
            return "STRUCTURALLY_COMPLETE_NOT_NATIVE_AUTHORITY";
        }
    }

    // A genuinely admitted implementation must guard before export marshaling and EVERY call.
    // No implementation is selected here: absence is a known activation/qualification gap.
    internal interface IOriginalNativeModule
    {
        // Guards are inert: no MSI/provider/native call may replace the thread's originating error record.
        // The actual image/runtime and ALL early initializers must be independently qualified BEFORE load.
        void BeforeConstructor(string sourceSymbol, string[] exactExports);
        void BeforeCall(string sourceSymbol, string export, string fixedRequest);
        IntPtr OriginalExport(string exactName);
        void ObserveOriginalCall(string export, long status);
        void ObserveOriginalException(string export, Exception original);
        void RetainUnknownOriginalOwner(object owner, string reason);
    }
    internal enum ObservationState { Absent, Unknown, Error, Observed }
    internal sealed class OriginalObservation<T>
    {
        internal ObservationState State = ObservationState.Unknown;
        internal T Value = default(T);
        internal string OriginalApi = null, SourceReference = null;
        internal long? NativeStatus = null;
    }
    internal enum InstallContext { UserManaged = 1, UserUnmanaged = 2, Machine = 4 }
    internal sealed class InstalledTuple
    {
        internal OriginalObservation<string> ProductCode = null, PackageCode = null, UpgradeCode = null, ProductVersion = null, OriginalUserSid = null;
        internal OriginalObservation<InstallContext> Context = null;
        internal IHeldInput LocalPackage = null, OriginalPackage = null;
        internal OriginalObservation<string>[] CachedRegistrations = null, FeatureStates = null, ComponentStates = null, DirectoryOverrides = null,
            PropertyProvenance = null, RegisteredTransforms = null;
        internal string OriginalProductSelectionReference = null;
        internal static readonly string[] NativeRoster = { "MsiEnumProductsExW", "MsiGetProductInfoExW",
            "MsiQueryFeatureStateExW", "MsiQueryComponentStateW" };
        internal string StructuralStatus()
        {
            if (String.IsNullOrEmpty(OriginalProductSelectionReference) || LocalPackage == null || OriginalPackage == null ||
                ProductCode == null || PackageCode == null || UpgradeCode == null || ProductVersion == null ||
                OriginalUserSid == null || Context == null || CachedRegistrations == null || FeatureStates == null ||
                ComponentStates == null || DirectoryOverrides == null || PropertyProvenance == null || RegisteredTransforms == null)
                return "UNRESOLVED_INSTALL_BRANCH";
            foreach (var scalar in new[] { ProductCode, PackageCode, UpgradeCode, ProductVersion, OriginalUserSid })
                if (scalar.State != ObservationState.Observed || scalar.Value == null || String.IsNullOrEmpty(scalar.OriginalApi) ||
                    String.IsNullOrEmpty(scalar.SourceReference)) return "UNRESOLVED_INSTALL_BRANCH";
            if (Context.State != ObservationState.Observed || String.IsNullOrEmpty(Context.OriginalApi) ||
                String.IsNullOrEmpty(Context.SourceReference) || Context.Value != InstallContext.UserManaged &&
                Context.Value != InstallContext.UserUnmanaged && Context.Value != InstallContext.Machine)
                return "UNRESOLVED_INSTALL_BRANCH";
            foreach (var list in new[] { CachedRegistrations, FeatureStates, ComponentStates, DirectoryOverrides, PropertyProvenance, RegisteredTransforms })
            {
                if (list.Length > 100000) return "INSTALLED_PROVENANCE_QUOTA";
                foreach (var row in list)
                    if (row == null || String.IsNullOrEmpty(row.OriginalApi) || String.IsNullOrEmpty(row.SourceReference) ||
                        row.State != ObservationState.Observed) return "UNRESOLVED_INSTALL_BRANCH";
            }
            return "INSTALLED_STRUCTURAL_INPUT_NOT_NATIVE_JOIN_AUTHORITY";
        }
    }
    internal sealed class CatalogEnvelope
    {
        internal Binding OriginalCatalogBytes = null, RawPublisherMembership = null;
        internal string DeclaredFormat = null, EnvelopeReference = null, CoverageReference = null, SelectedRootPolicyReference = null;
        internal string State { get { return OriginalCatalogBytes == null || RawPublisherMembership == null ||
            String.IsNullOrEmpty(DeclaredFormat) || String.IsNullOrEmpty(EnvelopeReference) || String.IsNullOrEmpty(CoverageReference) ||
            String.IsNullOrEmpty(SelectedRootPolicyReference) ? "CATALOG_ENVELOPE_UNRESOLVED" : "CATALOG_STRUCTURAL_INPUT_NOT_AUTHENTICATION"; } }
    }
    internal interface IHeldInput
    {
        string OriginalPath { get; }
        IntPtr OriginalReadableHandle { get; }
        Binding OriginalBytes { get; }
        string NativeObjectReference { get; } // Volume/full128-bit ID, no-follow ancestors and aliases.
        void ObserveBefore();
        void ObserveAfterOriginalClosure();
        // Missing association is always unresolved; neither a path nor a hash may implement this as proof.
        string OriginalDatabaseAssociation(uint database, IOriginalNativeModule module);
    }
    internal sealed class NativeResource
    {
        internal readonly int Ordinal;
        internal readonly string Kind;
        internal uint Handle;
        internal long AcquisitionResult;
        internal bool AcquisitionReturned;
        internal uint? CloseStatus;
        internal uint? ViewCloseStatus;
        internal bool View;
        internal NativeResource(int ordinal, string kind, uint handle, bool view)
        { Ordinal = ordinal; Kind = kind; Handle = handle; View = view; }
    }
    internal sealed class NativeObservation
    {
        internal readonly int Ordinal;
        internal readonly string Operation;
        internal readonly long Status;
        internal readonly MsiErrorField[] ExtendedFields;
        internal readonly Exception OriginalException;
        internal readonly int? HResult, Win32NativeErrorCode;
        internal NativeObservation(int ordinal, string operation, long status, MsiErrorField[] fields, Exception original)
        {
            Ordinal = ordinal; Operation = operation; Status = status; ExtendedFields = fields; OriginalException = original;
            HResult = original == null ? (int?)null : original.HResult;
            Win32NativeErrorCode = original is Win32Exception ? ((Win32Exception)original).NativeErrorCode : (int?)null;
        }
    }
    internal sealed class MsiErrorField
    {
        internal uint Ordinal;
        internal bool OriginalIsNull;
        internal int? OriginalIntegerGetter;
        internal string OriginalStringGetter;
        // MSI error records expose no schema: both getter observations remain raw, never a coerced type.
        internal string TypeDisposition = "UNRESOLVED_ERROR_RECORD_TYPE";
    }
    internal sealed class Quota : Exception { internal Quota(string cell) : base("QUOTA_" + cell) { } }
    internal sealed class Budget
    {
        internal long Rows, StreamBytes, ReceiptBytes;
        internal void Charge(long bytes)
        { if (bytes < 0 || bytes > 536870912 - ReceiptBytes) throw new Quota("RECEIPT"); ReceiptBytes += bytes; }
        internal void Row(long tableRows)
        { if (tableRows > 100000 || ++Rows > 500000) throw new Quota("ROWS"); Charge(128); }
        internal void Stream(int bytes)
        { if (bytes < 0 || bytes > 268435456 - StreamBytes) throw new Quota("STREAM_TOTAL"); StreamBytes += bytes; Charge(bytes * 2L + 128); }
    }
    // Invocation-private evidence. The originating owner keeps this object;
    // observation failure cannot replace its primary VERIFY/MSI disposition.
    internal sealed class RetentionInterruption
    {
        internal readonly RetentionInterruption Previous;
        internal readonly Exception OriginalException;
        internal readonly int Ordinal;
        internal RetentionInterruption(RetentionInterruption previous, Exception original)
        { Previous = previous; OriginalException = original; Ordinal = previous == null ? 1 : previous.Ordinal + 1; }
    }
    internal sealed class RetentionState
    {
        internal readonly object Owner;
        internal string Reason;
        internal Exception CallbackFailure;
        internal Exception LastInterruptionException, RecordingFailure;
        internal volatile bool CallbackCompleted;
        private RetentionInterruption interruptions;
        internal RetentionInterruption Interruptions { get { return Volatile.Read(ref interruptions); } }
        internal RetentionState(object owner, string reason) { Owner = owner; Reason = reason; }
        internal void Interrupted(Exception original)
        {
            // One original writer, immutable nodes, release/acquire publication.
            // No interruptible lock, wait or external observer callback is used
            // while retaining the exception from the original sleep.
            LastInterruptionException = original;
            try { Volatile.Write(ref interruptions, new RetentionInterruption(interruptions, original)); }
            catch (Exception recording) { RecordingFailure = recording; }
        }
    }
    internal static class Lifetime
    {
        internal static void Retain(IOriginalNativeModule module, RetentionState retained)
        {
            // SAME live invocation; callback failure cannot unwind unknown native ownership.
            try { module.RetainUnknownOriginalOwner(retained.Owner, retained.Reason); }
            catch (Exception original) { retained.CallbackFailure = original; }
            finally { retained.CallbackCompleted = true; }
            for (;;)
            {
                try { Thread.Sleep(1000); }
                catch (Exception original) { retained.Interrupted(original); }
                GC.KeepAlive(retained.Owner); GC.KeepAlive(retained); GC.KeepAlive(module);
            }
        }
    }
}
