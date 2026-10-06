// Offline original FILE subject; provider policy success never supplies an independent root.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace ServiceLasso.SourceAcquisition
{
    internal sealed class IndependentAnchor
    {
        internal Binding Der = null, Inclusion = null, RemovalOrExplicitUnresolved = null, PublisherPolicy = null;
        internal string Subject = null, Issuer = null, Serial = null, SpkiSha256 = null;
        internal string[] PermittedEku = null;
        internal long ValidFrom = 0, ValidTo = 0;
    }
    internal sealed class RootPolicyInput
    {
        internal string PolicyId = null;
        internal Binding[] PolicySources = null, Intermediates = null, RevocationEvidence = null;
        internal Binding SelectionTime = null, ValidationTime = null;
        internal IndependentAnchor[] Anchors = null;
        internal string StructuralStatus()
        {
            if (String.IsNullOrEmpty(PolicyId) || PolicySources == null || PolicySources.Length == 0 ||
                SelectionTime == null || ValidationTime == null || Anchors == null || Anchors.Length == 0 || Anchors.Length > 1024 ||
                Intermediates == null || Intermediates.Length > 4096 || RevocationEvidence == null || RevocationEvidence.Length == 0 ||
                PolicySources.Any(b => b == null) || Intermediates.Any(b => b == null) || RevocationEvidence.Any(b => b == null))
                return "INDEPENDENT_ROOT_TIME_REVOCATION_ABSENT";
            foreach (var root in Anchors)
                if (root == null || root.Der == null || root.Inclusion == null || root.RemovalOrExplicitUnresolved == null ||
                    root.PublisherPolicy == null || String.IsNullOrEmpty(root.Subject) || String.IsNullOrEmpty(root.Issuer) ||
                    String.IsNullOrEmpty(root.Serial) || String.IsNullOrEmpty(root.SpkiSha256) || root.PermittedEku == null ||
                    root.PermittedEku.Length == 0 || root.ValidTo < root.ValidFrom) return "UNQUALIFIED_ANCHOR_SELECTION";
            return "STRUCTURAL_ROOT_INPUT_NOT_AUTHORITY";
        }
    }
    internal interface IIndependentChainObserver
    {
        // Must acquire exact independently selected DER into invocation-private exclusive-root stores,
        // explicit bound FILETIME, codeSigning/timeStamping AND EKU, disable AIA, cache-only full-chain
        // revocation, exact terminal DER membership, every chain/path/EKU/time/error/info flag,
        // signed original CRL/OCSP freshness and actual timestamp token/imprint coverage.
        // No implementation or anchor bytes have been selected by this source package.
        string ObserveOriginalProviderState(IntPtr state, uint signatureIndex, RootPolicyInput roots, IHeldInput subject);
        void ReleaseAfterOriginalProviderClose();
    }
    internal sealed class WintrustExports
    {
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        internal delegate int Verify(IntPtr window, ref Guid action, IntPtr data);
        internal readonly Verify WinVerifyTrust;
        internal readonly IOriginalNativeModule Module;
        internal WintrustExports(IOriginalNativeModule module)
        {
            if (module == null) throw new InvalidOperationException("WINTRUST_MODULE_AUTHORITY_ABSENT");
            Module = module; module.BeforeConstructor("WintrustExports..ctor", new[] { "WinVerifyTrust" });
            module.BeforeCall("WintrustExports..ctor", "Marshal.GetDelegateForFunctionPointer", "WinVerifyTrust");
            IntPtr address = module.OriginalExport("WinVerifyTrust");
            if (address == IntPtr.Zero) throw new InvalidOperationException("WINTRUST_EXPORT_ABSENT");
            WinVerifyTrust = (Verify)Marshal.GetDelegateForFunctionPointer(address, typeof(Verify));
        }
    }
    [StructLayout(LayoutKind.Sequential)] internal struct TrustFile
    { internal uint Size; internal IntPtr Path, File, KnownSubject; }
    [StructLayout(LayoutKind.Sequential)] internal struct SignatureSettings
    { internal uint Size, Index, Flags, SecondaryCount, VerifiedIndex; internal IntPtr CryptoPolicy; }
    [StructLayout(LayoutKind.Sequential)] internal struct TrustData
    {
        internal uint Size;
        internal IntPtr PolicyCallback, SipClient;
        internal uint UiChoice, Revocation, UnionChoice;
        internal IntPtr File;
        internal uint StateAction;
        internal IntPtr State, Url;
        internal uint Flags, UiContext;
        internal IntPtr SignatureSettings;
    }
    internal sealed class SignatureObservation
    {
        internal uint RequestedIndex, ReportedIndex, SecondaryCount;
        internal int VerifyStatus, CloseStatus;
        internal IntPtr OriginalProviderState;
        internal string ChainDisposition = "INDEPENDENT_CHAIN_ADAPTER_ABSENT";
        internal Exception OriginalException;
        internal Exception OriginalCloseException;
    }
    internal sealed class TrustReceipt
    {
        internal readonly List<SignatureObservation> Signatures = new List<SignatureObservation>();
        internal string State = "UNQUALIFIED_INPUT";
        internal Binding Subject;
        internal SignatureObservation CountObservation;
    }
    internal sealed class OfflineAuthenticode
    {
        private readonly WintrustExports api;
        private readonly IHeldInput subject;
        private readonly RootPolicyInput roots;
        private readonly IIndependentChainObserver chains;
        private readonly TrustReceipt receipt = new TrustReceipt();
        private IntPtr path, file, signature, data;
        private bool entered;
        private bool providerClosurePending;
        private SignatureObservation current;
        internal SignatureObservation CurrentObservation { get { return current; } }
        internal bool ProviderClosurePending { get { return providerClosurePending; } }
        internal IntPtr[] OriginalInputPointers { get { return new[] { path, file, signature, data }; } }
        internal RetentionState CurrentRetention { get; private set; }
        private void Retain(string reason)
        {
            CurrentRetention = new RetentionState(this, reason);
            Lifetime.Retain(api.Module, CurrentRetention);
        }
        private void ReportException(string operation, Exception original)
        { try { api.Module.ObserveOriginalException(operation, original); } catch { /* Original remains in owner. */ } }
        internal OfflineAuthenticode(WintrustExports exports, IHeldInput held, RootPolicyInput rootPolicy,
            IIndependentChainObserver chainObserver)
        {
            if (exports == null || held == null || held.OriginalBytes == null || held.OriginalReadableHandle == IntPtr.Zero ||
                held.OriginalReadableHandle == new IntPtr(-1) || String.IsNullOrEmpty(held.NativeObjectReference))
                throw new ArgumentException("HELD_FILE_UNQUALIFIED");
            api = exports; subject = held; roots = rootPolicy; chains = chainObserver; receipt.Subject = held.OriginalBytes;
        }
        private SignatureObservation One(uint index, bool count)
        {
            var row = new SignatureObservation { RequestedIndex = index };
            current = row;
            var settings = new SignatureSettings { Size = (uint)Marshal.SizeOf(typeof(SignatureSettings)), Index = index,
                Flags = count ? 2U : 1U, CryptoPolicy = IntPtr.Zero };
            Marshal.StructureToPtr(settings, signature, false);
            var original = new TrustData { Size = (uint)Marshal.SizeOf(typeof(TrustData)), PolicyCallback = IntPtr.Zero,
                SipClient = IntPtr.Zero, UiChoice = 2, Revocation = 1, UnionChoice = 1, File = file, StateAction = 1,
                State = IntPtr.Zero, Url = IntPtr.Zero,
                Flags = 0x1000U | 0x40U | 0x2000U | 0x800U, UiContext = 0, SignatureSettings = signature };
            Marshal.StructureToPtr(original, data, false);
            Guid action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
            bool invoked = false, returned = false, closeReturned = false;
            try
            {
                api.Module.BeforeCall("OfflineAuthenticode.One", "WinVerifyTrust", count ? "COUNT:VERIFY" : "INDEX:" + index + ":VERIFY");
                invoked = true;
                providerClosurePending = true;
                row.VerifyStatus = api.WinVerifyTrust(new IntPtr(-1), ref action, data); returned = true;
                original = (TrustData)Marshal.PtrToStructure(data, typeof(TrustData));
                row.OriginalProviderState = original.State;
                settings = (SignatureSettings)Marshal.PtrToStructure(signature, typeof(SignatureSettings));
                row.SecondaryCount = settings.SecondaryCount; row.ReportedIndex = settings.VerifiedIndex;
                api.Module.ObserveOriginalCall("WinVerifyTrust:VERIFY", row.VerifyStatus);
                if (!count && row.VerifyStatus == 0 && row.ReportedIndex == index && roots != null &&
                    roots.StructuralStatus() == "STRUCTURAL_ROOT_INPUT_NOT_AUTHORITY" && chains != null && original.State != IntPtr.Zero)
                    row.ChainDisposition = chains.ObserveOriginalProviderState(original.State, index, roots, subject);
            }
            catch (Exception originalError)
            { row.OriginalException = originalError; ReportException("WinVerifyTrust:VERIFY", originalError); }
            finally
            {
                if (invoked && !returned) Retain("UNKNOWN_ORIGINAL_VERIFY_STATE");
                if (returned)
                {
                    try
                    {
                        // Same original data/state even after nonzero VERIFY; never a fresh substitute context.
                        original = (TrustData)Marshal.PtrToStructure(data, typeof(TrustData)); original.StateAction = 2;
                        Marshal.StructureToPtr(original, data, false);
                        api.Module.BeforeCall("OfflineAuthenticode.One", "WinVerifyTrust", "ORIGINAL_STATE:CLOSE");
                        row.CloseStatus = api.WinVerifyTrust(new IntPtr(-1), ref action, data); closeReturned = true;
                        if (row.CloseStatus == 0) providerClosurePending = false;
                        api.Module.ObserveOriginalCall("WinVerifyTrust:CLOSE", row.CloseStatus);
                    }
                    catch (Exception originalCloseError)
                    { row.OriginalCloseException = originalCloseError; ReportException("WinVerifyTrust:CLOSE", originalCloseError); }
                    if (!closeReturned || row.CloseStatus != 0) Retain("UNKNOWN_OR_FAILED_ORIGINAL_PROVIDER_CLOSE");
                }
            }
            return row;
        }
        internal TrustReceipt Read()
        {
            if (entered) throw new InvalidOperationException("OWNER_ALREADY_ENTERED"); entered = true;
            subject.ObserveBefore();
            try
            {
                // Runtime/Marshal constructors require the exact admitted source/image/request closure too.
                api.Module.BeforeConstructor("OfflineAuthenticode.Read", new[] { "Marshal.StringToHGlobalUni", "Marshal.AllocHGlobal", "Marshal.SizeOf" });
                path = Marshal.StringToHGlobalUni(subject.OriginalPath);
                file = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(TrustFile)));
                signature = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SignatureSettings)));
                data = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(TrustData)));
                Marshal.StructureToPtr(new TrustFile { Size = (uint)Marshal.SizeOf(typeof(TrustFile)), Path = path,
                    File = subject.OriginalReadableHandle, KnownSubject = IntPtr.Zero }, file, false);
                receipt.CountObservation = One(0, true);
                if (receipt.CountObservation.VerifyStatus != 0 || receipt.CountObservation.OriginalException != null || receipt.CountObservation.OriginalCloseException != null ||
                    receipt.CountObservation.SecondaryCount > 31) { receipt.State = "NATIVE_FAILURE_OR_SIGNATURE_QUOTA"; return receipt; }
                for (uint index = 0; index <= receipt.CountObservation.SecondaryCount; index++) receipt.Signatures.Add(One(index, false));
                receipt.State = "PROVIDER_POLICY_SUCCESS_INDEPENDENT_TRUST_UNQUALIFIED";
                foreach (var row in receipt.Signatures)
                    if (row.VerifyStatus != 0 || row.OriginalException != null || row.OriginalCloseException != null || row.ReportedIndex != row.RequestedIndex)
                        receipt.State = "NATIVE_FAILURE";
                // No generic PASS or AUTHENTICATED result: positive independent chain/coverage authority is not supplied.
                return receipt;
            }
            finally
            {
                // No independent chain release or original input free may run
                // while an entered VERIFY lacks its same-state successful CLOSE.
                if (providerClosurePending) Retain("PENDING_ORIGINAL_PROVIDER_INPUTS");
                try { if (chains != null) chains.ReleaseAfterOriginalProviderClose(); }
                catch (Exception original) { ReportException("private-chain-release", original);
                    Retain("UNKNOWN_PRIVATE_CHAIN_RELEASE"); }
                if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
                if (signature != IntPtr.Zero) Marshal.FreeHGlobal(signature);
                if (file != IntPtr.Zero) Marshal.FreeHGlobal(file);
                if (path != IntPtr.Zero) Marshal.FreeHGlobal(path);
                subject.ObserveAfterOriginalClosure(); GC.KeepAlive(subject); GC.KeepAlive(api);
            }
        }
    }
}
