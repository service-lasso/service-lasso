// Prospective AC-4DI.4 cases, UNRUN. Synthetic source cases do not supply native authority.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using ServiceLasso.SourceAcquisition;

internal static class Core1681AcquisitionSourceCases
{
    private static void Expect(bool condition, string name)
    { if (!condition) throw new InvalidDataException("SOURCE_CASE:" + name); }
    private static Binding Bound(string name, byte[] bytes)
    { return new Binding(name, bytes.LongLength, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()); }
    internal static void RunPure()
    {
        foreach (string type in new[] { "s0", "S255", "i2", "I4", "v0", "V0" })
            Expect(MsiReadOnly.SupportedDescriptor(type), "MSI_positive_type:" + type);
        foreach (string type in new[] { "", "i0", "i8", "v1", "s256", "s01", "g0", "O0", "s-1", "i2junk" })
            Expect(!MsiReadOnly.SupportedDescriptor(type), "MSI_unknown_type:" + type);
        foreach (string part in new[] { "/[Content_Types].xml", "/a/b.xml", "/_rels/.rels", "/a/%C3%A9.xml" })
        {
            // Brackets are deliberately outside this finite canonical encoding; require escaped representation.
            bool expected = part != "/[Content_Types].xml";
            Expect(OpcCoverage.PartUri(part) == expected, "OPC_finite_uri:" + part);
        }
        foreach (string part in new[] { "a.xml", "//a", "/a//b", "/a/../b", "/a/%2E%2E/b", "/a/%252F", "/a/%2f", "/a?b", "/a#b", "/a\\b", "/a/%C0%AF" })
            Expect(!OpcCoverage.PartUri(part), "OPC_negative_uri:" + part);
        string target;
        Expect(OpcCoverage.ReferenceUri("/a.xml?ContentType=application/xml", "application/xml", out target) && target == "/a.xml", "OPC_reference_positive");
        Expect(!OpcCoverage.ReferenceUri("/a.xml?ContentType=application/xml&x=y", "application/xml", out target), "OPC_reference_extra_query");
        Expect(!OpcCoverage.ReferenceUri("https://a/a.xml?ContentType=application/xml", "application/xml", out target), "OPC_external_reference");
        var bytes = new byte[] { 1, 2, 3 }; Binding binding = Bound("independent-case-bytes", bytes);
        var origin = new Origin(binding, binding, binding, binding, binding, binding, "case.actual.symbol",
            "synthetic-selected-branch", "synthetic-actor", "synthetic-module");
        var candidate = new Candidate(0, "suffixless.dat", "SELECTED", "synthetic-all-member-topology", "synthetic-held-object", null, binding);
        var request = new Request(origin, "compiler", "suffixless.dat", "original-api", "original-flags", "original-cwd",
            "synthetic-complete-dynamic-source", "synthetic-mutation-boundary", new[] { candidate });
        Expect(RequestGraph.Validate(new[] { request }, new[] { "compiler" }) == "STRUCTURALLY_COMPLETE_NOT_NATIVE_AUTHORITY", "GRAPH_positive_structural_route");
        Expect(RequestGraph.Validate(new[] { request }, new[] { "compiler", "loader" }) == "MISSING_REQUEST_FAMILY", "GRAPH_missing_family");
        var unknown = new Request(origin, "compiler", "suffixless.dat", "original-api", "original-flags", "original-cwd",
            null, "synthetic-mutation-boundary", new[] { candidate });
        Expect(RequestGraph.Validate(new[] { unknown }, new[] { "compiler" }) == "UNQUALIFIED_ORIGIN_OR_DYNAMIC_NAMESPACE", "GRAPH_unknown_dynamic");
        var shadow = new Candidate(0, "suffixless.dat", "SHADOW", "synthetic-topology", "synthetic-held", null, null);
        var wrong = new Request(origin, "compiler", "token", "api", "flags", "cwd", "dynamic", "mutation", new[] { shadow });
        Expect(RequestGraph.Validate(new[] { wrong }, new[] { "compiler" }) == "UNQUALIFIED_REACHABLE_BYTES", "GRAPH_no_suffix_exemption");
        var absent = new Candidate(0, "earlier-shadow", "ABSENT", "synthetic-topology", null, null, null);
        wrong = new Request(origin, "compiler", "token", "api", "flags", "cwd", "dynamic", "mutation", new[] { absent, candidate });
        Expect(RequestGraph.Validate(new[] { wrong }, new[] { "compiler" }) == "UNQUALIFIED_NEGATIVE_NAME", "GRAPH_missing_negative_name");
        Expect(new RootPolicyInput().StructuralStatus() == "INDEPENDENT_ROOT_TIME_REVOCATION_ABSENT", "ROOT_absent_never_self_signed_pass");
        var budget = new Budget(); budget.Charge(536870912);
        bool quota = false; try { budget.Charge(1); } catch (Quota) { quota = true; }
        Expect(quota, "RECEIPT_no_truncation_success");
        RunStoredParts();
    }
    private static uint Crc(byte[] bytes)
    {
        // Independent PKWARE CRC polynomial and zero initial/final xor convention.
        uint value = UInt32.MaxValue;
        foreach (byte item in bytes) { value ^= item; for (int i = 0; i < 8; i++) value =
            (value & 1) != 0 ? (value >> 1) ^ 0xEDB88320U : value >> 1; }
        return ~value;
    }
    private static byte[] StoredZip(Dictionary<string, byte[]> members)
    {
        using (var stream = new MemoryStream())
        using (var writer = new BinaryWriter(stream, Encoding.UTF8, true))
        {
            var positions = new Dictionary<string, uint>();
            foreach (var pair in members)
            {
                positions.Add(pair.Key, (uint)stream.Position); byte[] name = Encoding.UTF8.GetBytes(pair.Key);
                writer.Write(0x04034b50U); writer.Write((ushort)20); writer.Write((ushort)0x800); writer.Write((ushort)0);
                writer.Write((ushort)0); writer.Write((ushort)0); writer.Write(Crc(pair.Value));
                writer.Write((uint)pair.Value.Length); writer.Write((uint)pair.Value.Length);
                writer.Write((ushort)name.Length); writer.Write((ushort)0); writer.Write(name); writer.Write(pair.Value);
            }
            uint central = (uint)stream.Position;
            foreach (var pair in members)
            {
                byte[] name = Encoding.UTF8.GetBytes(pair.Key);
                writer.Write(0x02014b50U); writer.Write((ushort)0x0314); writer.Write((ushort)20); writer.Write((ushort)0x800);
                writer.Write((ushort)0); writer.Write((ushort)0); writer.Write((ushort)0); writer.Write(Crc(pair.Value));
                writer.Write((uint)pair.Value.Length); writer.Write((uint)pair.Value.Length); writer.Write((ushort)name.Length);
                writer.Write((ushort)0); writer.Write((ushort)0); writer.Write((ushort)0); writer.Write((ushort)0);
                writer.Write(0x80000000U); writer.Write(positions[pair.Key]); writer.Write(name);
            }
            uint centralLength = (uint)stream.Position - central;
            writer.Write(0x06054b50U); writer.Write((ushort)0); writer.Write((ushort)0);
            writer.Write((ushort)members.Count); writer.Write((ushort)members.Count); writer.Write(centralLength);
            writer.Write(central); writer.Write((ushort)0); writer.Flush(); return stream.ToArray();
        }
    }
    private static void RunStoredParts()
    {
        var members = new Dictionary<string, byte[]>();
        members.Add("[Content_Types].xml", Encoding.UTF8.GetBytes("<Types/>"));
        for (int i = 0; i < 6; i++) members.Add("metadata/part" + i + ".xml", Encoding.UTF8.GetBytes("<original>" + i + "</original>"));
        byte[] archive = StoredZip(members); var claims = members.Select(pair => new Core1681BoundedVsix.Claim {
            Name = pair.Key, Sha256 = Convert.ToHexString(SHA256.HashData(pair.Value)) }).ToArray();
        Dictionary<string, byte[]> selected;
        var full = Core1681BoundedVsix.Observe(archive, archive.Length, Convert.ToHexString(SHA256.HashData(archive)),
            claims, members.Keys.Select(name => "/" + name).ToArray(), out selected);
        Expect(full.Members.Count == 7 && full.MatchedClaims == 7 && selected.Count == 7, "PART_full_roster_and_selected_positive");
        foreach (var pair in members) Expect(selected["/" + pair.Key].SequenceEqual(pair.Value), "PART_original_bytes:" + pair.Key);
        byte[] firstCorrupt = (byte[])archive.Clone(); firstCorrupt[full.Members[0].DataOffset] ^= 1;
        bool firstCrc = false;
        try { Core1681BoundedVsix.Observe(firstCorrupt, firstCorrupt.Length, Convert.ToHexString(SHA256.HashData(firstCorrupt)), claims,
            new[] { "/metadata/part0.xml" }, out selected); }
        catch (InvalidDataException original) { firstCrc = original.Message == "CRC mismatch"; }
        Expect(firstCrc && selected == null, "PART_changed_bytes_resealed_archive_hits_CRC");
        byte[] corrupt = (byte[])archive.Clone(); corrupt[full.Members[6].DataOffset] ^= 1;
        bool crc = false;
        try { Core1681BoundedVsix.Observe(corrupt, corrupt.Length, Convert.ToHexString(SHA256.HashData(corrupt)), claims,
            new[] { "/metadata/part0.xml" }, out selected); }
        catch (InvalidDataException original) { crc = original.Message == "CRC mismatch"; }
        Expect(crc && selected == null, "PART_late_CRC_never_publishes_prior_selected_bytes");
        var wrongClaims = claims.Select(c => new Core1681BoundedVsix.Claim { Name = c.Name, Sha256 = c.Sha256 }).ToArray();
        wrongClaims[6].Sha256 = new string('0', 64);
        bool claim = false;
        try { Core1681BoundedVsix.Observe(archive, archive.Length, Convert.ToHexString(SHA256.HashData(archive)), wrongClaims,
            new[] { "/metadata/part0.xml" }, out selected); }
        catch (InvalidDataException original) { claim = original.Message == "claim bytes mismatch"; }
        Expect(claim && selected == null, "PART_late_claim_never_publishes_prior_selected_bytes");
        bool missing = false;
        try { Core1681BoundedVsix.Observe(archive, archive.Length, Convert.ToHexString(SHA256.HashData(archive)), claims,
            new[] { "/metadata/part0.xml", "/metadata/missing.xml" }, out selected); }
        catch (InvalidDataException original) { missing = original.Message == "selected member missing"; }
        Expect(missing && selected == null, "PART_missing_selection_never_publishes_present_selection");
    }
    // Direct original native cases need genuine separately admitted module, held package, database association,
    // anchors and installed branch. This entrypoint fabricates none and does not bypass missing resources.
    internal static void ObserveOriginalNative(MsiExports msi, WintrustExports trust, IHeldInput original,
        RootPolicyInput roots, IIndependentChainObserver chains)
    {
        var msiOwner = new MsiReadOnly(msi, original);
        var rows = msiOwner.Read();
        Expect(msiOwner.CurrentRetention == null, "MSI_normal_genuine_closure_no_retention");
        Expect(rows.Tables.Count == 20 && rows.Tables.Any(t => t.Name == "Property" && t.State == "ROWS_OBSERVED"), "MSI_original_native_positive");
        Expect(rows.Resources.All(resource => resource.CloseStatus == 0), "MSI_actual_original_resource_close");
        Expect(rows.InstalledContext == "UNRESOLVED_INSTALL_BRANCH" && rows.Eligibility != "AUTHENTICATED_DISTRIBUTION", "MSI_no_invented_installed_join");
        var trustOwner = new OfflineAuthenticode(trust, original, roots, chains);
        var signature = trustOwner.Read();
        Expect(trustOwner.CurrentRetention == null && !trustOwner.ProviderClosurePending,
            "TRUST_normal_genuine_provider_closure_no_retention");
        Expect(signature.CountObservation != null && signature.Signatures.Count > 0 && signature.Signatures.Count <= 32,
            "TRUST_original_finite_signature_roster");
        Expect(signature.Signatures.All(row => row.CloseStatus == 0), "TRUST_each_original_VERIFY_CLOSE");
        Expect(signature.State != "AUTHENTICATED_DISTRIBUTION", "TRUST_provider_not_independent_authentication");
    }
    // Called by a separately admitted original module's retention observer for the
    // actual nested-close failure scenario. Never creates delegates or native results.
    internal static void ObserveOriginalNestedCloseRetention(object sameOwner, uint originalStatus, uint errorCloseStatus)
    {
        var owner = sameOwner as MsiReadOnly;
        Expect(owner != null && originalStatus != 0 && errorCloseStatus != 0, "MSI_nested_close_original_owner");
        var receipt = owner.CurrentReceipt;
        Expect(receipt.Resources.Count(r => r.Kind == "extended-error-record") == 1,
            "MSI_nested_close_no_recursive_error_acquisition");
        Expect(receipt.Resources.Any(r => r.Kind != "extended-error-record" && r.CloseStatus == originalStatus) &&
            receipt.Resources.Single(r => r.Kind == "extended-error-record").CloseStatus == errorCloseStatus,
            "MSI_nested_close_same_original_failed_resources_retained");
        Expect(receipt.Observations.Any(o => o.Operation == "MsiCloseHandle:extended-error" &&
            o.Status == originalStatus && o.ExtendedFields != null) &&
            receipt.Observations.Last(o => o.Operation == "MsiCloseHandle").Status == errorCloseStatus,
            "MSI_nested_close_original_status_fields_and_cleanup_status");
    }
    // Independently admitted fixture observes the ACTUAL original Read thread
    // after its genuine native failure reaches the production retention callback.
    // No delegate, provider status, resource handle or replacement owner is made
    // here. The retained thread must be hosted in its own original fixture actor;
    // this observer never closes it, retries native close or reports eligibility.
    private static void InterruptOriginalRetainedThread(Thread originalThread, RetentionState retained,
        object originalOwner, Exception callbackFailure, Action assertOriginalStillHeld)
    {
        Expect(originalThread != null && originalThread != Thread.CurrentThread && originalThread.IsAlive,
            "RETENTION_actual_separate_original_read_thread");
        Expect(retained != null && Object.ReferenceEquals(retained.Owner, originalOwner), "RETENTION_same_original_owner");
        Expect(SpinWait.SpinUntil(() => retained.CallbackCompleted, 5000), "RETENTION_actual_callback_completed");
        // Separate genuine callback-success and callback-failure vectors. For
        // failure, the fixture supplies the exact thrown exception; null does
        // not substitute for an expected failure.
        Expect(Object.ReferenceEquals(retained.CallbackFailure, callbackFailure), "RETENTION_original_callback_disposition_retained");
        for (int attempt = 0; attempt < 3; attempt++)
        {
            var previous = retained.Interruptions;
            int before = previous == null ? 0 : previous.Ordinal;
            originalThread.Interrupt();
            Expect(SpinWait.SpinUntil(() => {
                var latest = retained.Interruptions; return latest != null && latest.Ordinal > before;
            }, 5000), "RETENTION_original_interrupt_observed");
            var observed = retained.Interruptions;
            Expect(observed.Ordinal == before + 1 && observed.OriginalException is ThreadInterruptedException &&
                Object.ReferenceEquals(observed.Previous, previous), "RETENTION_each_original_interrupt_appended_once");
            Expect(originalThread.IsAlive && Object.ReferenceEquals(retained.Owner, originalOwner) &&
                Object.ReferenceEquals(retained.CallbackFailure, callbackFailure), "RETENTION_no_original_owner_or_failure_replacement");
            assertOriginalStillHeld();
        }
    }
    internal static void ObserveOriginalTrustInterruptedRetention(Thread originalThread, OfflineAuthenticode owner,
        Exception originalFailure, Exception callbackFailure, Func<bool> originalReadReturned,
        Func<int> actualChainReleaseCalls, Func<int> actualHeldAfterClosureCalls)
    {
        Expect(owner != null && owner.ProviderClosurePending, "TRUST_actual_pending_native_provider");
        var row = owner.CurrentObservation;
        Expect(row != null && (row.OriginalException != null || row.OriginalCloseException != null || row.CloseStatus != 0),
            "TRUST_actual_original_VERIFY_or_CLOSE_failure");
        if (originalFailure != null) Expect(Object.ReferenceEquals(row.OriginalException, originalFailure) ||
            Object.ReferenceEquals(row.OriginalCloseException, originalFailure), "TRUST_original_exception_identity");
        IntPtr[] pointers = owner.OriginalInputPointers;
        Expect(pointers.All(p => p != IntPtr.Zero), "TRUST_original_acquired_native_inputs");
        var retained = owner.CurrentRetention;
        InterruptOriginalRetainedThread(originalThread, retained, owner, callbackFailure, () => {
            Expect(!originalReadReturned() && actualChainReleaseCalls() == 0 && actualHeldAfterClosureCalls() == 0,
                "TRUST_no_caller_receipt_chain_or_subject_cleanup_after_interrupt");
            Expect(owner.ProviderClosurePending && owner.OriginalInputPointers.SequenceEqual(pointers) &&
                Object.ReferenceEquals(owner.CurrentObservation, row) && Object.ReferenceEquals(owner.CurrentRetention, retained),
                "TRUST_same_native_inputs_row_and_retention_after_interrupt");
            if (originalFailure != null) Expect(Object.ReferenceEquals(row.OriginalException, originalFailure) ||
                Object.ReferenceEquals(row.OriginalCloseException, originalFailure), "TRUST_primary_preserved_after_interrupt");
        });
    }
    internal static void ObserveOriginalMsiInterruptedRetention(Thread originalThread, MsiReadOnly owner,
        Exception callbackFailure, Func<bool> originalReadReturned, Func<int> actualHeldAfterClosureCalls)
    {
        Expect(owner != null && owner.CurrentRetention != null, "MSI_actual_retained_read_owner");
        var receipt = owner.CurrentReceipt;
        var resources = receipt.Resources.ToArray();
        var observations = receipt.Observations.ToArray();
        Expect(resources.Length > 0 && observations.Any(o => o.OriginalException != null || o.Status != 0),
            "MSI_actual_acquired_resources_and_original_failure");
        var statuses = resources.Select(r => r.CloseStatus).ToArray();
        var retained = owner.CurrentRetention;
        InterruptOriginalRetainedThread(originalThread, retained, owner, callbackFailure, () => {
            Expect(!originalReadReturned() && actualHeldAfterClosureCalls() == 0,
                "MSI_no_caller_receipt_or_subject_cleanup_after_interrupt");
            Expect(receipt.Resources.SequenceEqual(resources) && receipt.Observations.SequenceEqual(observations) &&
                resources.Select(r => r.CloseStatus).SequenceEqual(statuses) && Object.ReferenceEquals(owner.CurrentRetention, retained),
                "MSI_no_native_retry_new_resource_or_replaced_original_observation");
        });
    }
    internal static void ObserveOriginalXmlGrammar(IOriginalNativeModule qualifiedXmlRuntime)
    {
        const string ds = "http://www.w3.org/2000/09/xmldsig#";
        const string opc = "http://schemas.openxmlformats.org/package/2006/digital-signature";
        string selector = "<o:RelationshipReference SourceId='r1'/>";
        string prefix = "<Signature xmlns='" + ds + "' xmlns:o='" + opc + "'><SignedInfo><CanonicalizationMethod Algorithm='" +
            OpcCoverage.Canonical + "'/><SignatureMethod Algorithm='" + OpcCoverage.Signature + "'/><Reference URI='/a.xml?ContentType=application/xml'><Transforms>";
        string suffix = "</Transforms><DigestMethod Algorithm='" + OpcCoverage.Digest + "'/><DigestValue>" +
            Convert.ToBase64String(new byte[32]) + "</DigestValue></Reference></SignedInfo></Signature>";
        string relation = "<Transform Algorithm='" + OpcCoverage.Relationships + "'>";
        string canonical = "<Transform Algorithm='" + OpcCoverage.Canonical + "'>";
        string[] bodies = { relation + selector + "</Transform>" + canonical + "</Transform>",
            relation + "</Transform>" + canonical + selector + "</Transform>",
            relation + "<o:Unsupported SourceId='r1'/></Transform>" + canonical + "</Transform>",
            canonical + selector + "</Transform>" };
        for (int i = 0; i < bodies.Length; i++)
        {
            var result = OpcCoverage.Inspect(Encoding.UTF8.GetBytes(prefix + bodies[i] + suffix), qualifiedXmlRuntime);
            Expect(result.State == (i == 0 ? "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED" : "UNSUPPORTED_TRANSFORM_PARAMETERS"),
                "OPC_transform_position_parameter_case:" + i);
            if (i == 1) Expect(result.References.Count == 0,
                "OPC_invalid_transform_never_projected");
        }
        string[] containers = { "<XPath>unsupported</XPath>",
            "<f:Transform xmlns:f='urn:foreign' Algorithm='" + OpcCoverage.Canonical + "'/>",
            canonical + "</Transform><XPath/>", selector, "unexpected text", "<?unsupported parameter?>" };
        foreach (string body in containers)
        {
            byte[] original = Encoding.UTF8.GetBytes(prefix + body + suffix);
            var result = OpcCoverage.Inspect(original, qualifiedXmlRuntime);
            Expect(result.State == "UNSUPPORTED_TRANSFORM_CONTAINER" && result.OriginalXml.SequenceEqual(original),
                "OPC_entire_unsupported_transform_container_retains_original:" + body);
            Expect(result.References.Count == 0, "OPC_unsupported_container_not_projected");
        }
        foreach (string body in new[] { "", canonical + "</Transform>" })
        {
            var result = OpcCoverage.Inspect(Encoding.UTF8.GetBytes(prefix + body + suffix), qualifiedXmlRuntime);
            Expect(result.State == "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED", "OPC_natural_container_positive");
        }
        string valid = prefix + relation + selector + "</Transform>" + canonical + "</Transform>" + suffix;
        string canonicalNode = canonical + "</Transform>";
        string[] unsupportedTransforms = {
            canonical + "unsupported parameter</Transform>",
            canonical.Replace("Algorithm=", "Unsupported='parameter' Algorithm=") + "</Transform>",
            canonical + "<?parameter unsupported?></Transform>",
            canonical + "<![CDATA[parameter]]></Transform>"
        };
        foreach (string changed in unsupportedTransforms)
            ExpectUnsupportedXml(valid.Replace(canonicalNode, changed), "UNSUPPORTED_TRANSFORM_PARAMETERS", qualifiedXmlRuntime);
        foreach (string changed in new[] {
            relation + "mixed parameter" + selector + "</Transform>",
            relation.Replace("Algorithm=", "Unsupported='parameter' Algorithm=") + selector + "</Transform>",
            relation + "<?parameter unsupported?>" + selector + "</Transform>",
            relation + selector.Replace("/>", ">parameter</o:RelationshipReference>") + "</Transform>",
            relation + selector.Replace("/>", "><?parameter unsupported?></o:RelationshipReference>") + "</Transform>"
        }) ExpectUnsupportedXml(valid.Replace(relation + selector + "</Transform>", changed), "UNSUPPORTED_TRANSFORM_PARAMETERS", qualifiedXmlRuntime);
        foreach (string method in new[] { "CanonicalizationMethod", "SignatureMethod", "DigestMethod" })
        {
            string algorithm = method == "CanonicalizationMethod" ? OpcCoverage.Canonical : method == "SignatureMethod" ? OpcCoverage.Signature : OpcCoverage.Digest;
            string original = "<" + method + " Algorithm='" + algorithm + "'/>";
            string state = method == "DigestMethod" ? "UNSUPPORTED_DIGEST_PARAMETERS" : "UNSUPPORTED_SIGNATURE_ALGORITHM_OR_CANONICALIZATION";
            foreach (string replacement in new[] {
                original.Replace("/>", ">parameter</" + method + ">"),
                original.Replace("Algorithm=", "Unsupported='parameter' Algorithm="),
                original.Replace("/>", "><?parameter unsupported?></" + method + ">"),
                original.Replace("/>", "><foreign/></" + method + ">")
            }) ExpectUnsupportedXml(valid.Replace(original, replacement), state, qualifiedXmlRuntime);
        }
        foreach (string node in new[] { "SignedInfo", "Reference" })
        {
            string state = node == "SignedInfo" ? "UNSUPPORTED_SIGNED_INFO_STRUCTURE" : "UNSUPPORTED_REFERENCE_STRUCTURE";
            foreach (string body in new[] { "<Transform Algorithm='unsupported-XPath'/>", "mixed parameter", "<?parameter unsupported?>", "<foreign/>" })
                ExpectUnsupportedXml(valid.Replace("</" + node + ">", body + "</" + node + ">"), state, qualifiedXmlRuntime);
        }
        string digestText = Convert.ToBase64String(new byte[32]);
        foreach (string body in new[] { "<foreign>" + digestText + "</foreign>", "<?parameter unsupported?>" + digestText,
            "<![CDATA[" + digestText + "]]>" })
            ExpectUnsupportedXml(valid.Replace("<DigestValue>" + digestText, "<DigestValue>" + body), "UNSUPPORTED_DIGEST_VALUE_STRUCTURE", qualifiedXmlRuntime);
        ExpectUnsupportedXml(valid.Replace("<DigestValue>", "<DigestValue Unsupported='parameter'>"), "UNSUPPORTED_DIGEST_VALUE_STRUCTURE", qualifiedXmlRuntime);
        ExpectUnsupportedXml(valid.Replace("<SignedInfo>", "<SignedInfo Unsupported='parameter'>"), "UNSUPPORTED_SIGNED_INFO_STRUCTURE", qualifiedXmlRuntime);
        ExpectUnsupportedXml(valid.Replace("<Reference URI=", "<Reference Unsupported='parameter' URI="), "UNSUPPORTED_REFERENCE_STRUCTURE", qualifiedXmlRuntime);
        string inert = valid.Replace("<SignedInfo>", "<SignedInfo Id='signed' xmlns:inert='urn:inert'> \n<!--inert-->")
            .Replace("<Reference URI=", "<Reference Id='reference' Type='urn:legitimate-type' URI=")
            .Replace(selector, "<o:RelationshipReference xmlns:inert='urn:selector' SourceId='r1'> \n<!--inert--></o:RelationshipReference>")
            .Replace(canonicalNode, canonical + " \n<!--inert--></Transform>")
            .Replace(digestText, " \n" + digestText + "<!--inert-->")
            .Replace("</Signature>", "<SignatureValue Id='value'>unqualified</SignatureValue><KeyInfo><foreign xmlns='urn:foreign'/></KeyInfo><Object><foreign xmlns='urn:foreign'/></Object></Signature>");
        Expect(OpcCoverage.Inspect(Encoding.UTF8.GetBytes(inert), qualifiedXmlRuntime).State == "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED",
            "OPC_optional_Id_Type_namespace_whitespace_comments_and_unqualified_extensions_positive");
        string noTransform = prefix.Replace("<Transforms>", "") + suffix.Replace("</Transforms>", "");
        Expect(OpcCoverage.Inspect(Encoding.UTF8.GetBytes(noTransform), qualifiedXmlRuntime).State == "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED",
            "OPC_natural_no_transform_positive");
        string group = "<o:RelationshipsGroupReference SourceType='urn:legitimate-group'/>";
        Expect(OpcCoverage.Inspect(Encoding.UTF8.GetBytes(valid.Replace(selector, group)), qualifiedXmlRuntime).State ==
            "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED", "OPC_natural_relationship_group_positive");
        foreach (string replacement in new[] {
            group.Replace("/>", ">parameter</o:RelationshipsGroupReference>"),
            group.Replace("SourceType=", "Unsupported='parameter' SourceType="),
            group.Replace("/>", "><foreign/></o:RelationshipsGroupReference>"),
            group.Replace("/>", "><?parameter unsupported?></o:RelationshipsGroupReference>")
        }) ExpectUnsupportedXml(valid.Replace(selector, replacement), "UNSUPPORTED_TRANSFORM_PARAMETERS", qualifiedXmlRuntime);
        string methods = "<CanonicalizationMethod Algorithm='" + OpcCoverage.Canonical + "'/><SignatureMethod Algorithm='" + OpcCoverage.Signature + "'/>";
        string reversed = "<SignatureMethod Algorithm='" + OpcCoverage.Signature + "'/><CanonicalizationMethod Algorithm='" + OpcCoverage.Canonical + "'/>";
        ExpectUnsupportedXml(valid.Replace(methods, reversed), "UNSUPPORTED_SIGNED_INFO_ORDER", qualifiedXmlRuntime);
        string digestNode = "<DigestMethod Algorithm='" + OpcCoverage.Digest + "'/><DigestValue>" + digestText + "</DigestValue>";
        ExpectUnsupportedXml(noTransform.Replace(digestNode, "<DigestValue>" + digestText + "</DigestValue><DigestMethod Algorithm='" + OpcCoverage.Digest + "'/>"),
            "UNSUPPORTED_REFERENCE_ORDER", qualifiedXmlRuntime);
        string reference = noTransform.Substring(noTransform.IndexOf("<Reference", StringComparison.Ordinal));
        reference = reference.Substring(0, reference.IndexOf("</Reference>", StringComparison.Ordinal) + "</Reference>".Length);
        string manifest = "<Object><Manifest Id='manifest'> \n<!--inert-->" + reference + "</Manifest></Object>";
        string manifestPositive = valid.Replace("</Signature>", manifest + "</Signature>");
        Expect(OpcCoverage.Inspect(Encoding.UTF8.GetBytes(manifestPositive), qualifiedXmlRuntime).State ==
            "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED", "OPC_natural_manifest_positive");
        foreach (string body in new[] { "mixed parameter", "<Transform Algorithm='unsupported'/>", "<?parameter unsupported?>" })
            ExpectUnsupportedXml(manifestPositive.Replace("</Manifest>", body + "</Manifest>"), "UNSUPPORTED_MANIFEST_STRUCTURE", qualifiedXmlRuntime);
        ExpectUnsupportedXml(manifestPositive.Replace("<Manifest Id=", "<Manifest Unsupported='parameter' Id="),
            "UNSUPPORTED_MANIFEST_STRUCTURE", qualifiedXmlRuntime);
    }
    private static void ExpectUnsupportedXml(string xml, string state, IOriginalNativeModule qualifiedXmlRuntime)
    {
        byte[] original = Encoding.UTF8.GetBytes(xml);
        var result = OpcCoverage.Inspect(original, qualifiedXmlRuntime);
        Expect(result.State == state && result.OriginalXml.SequenceEqual(original), "OPC_complete_grammar:" + state);
        Expect(OpcCoverage.Coverage(result, new Dictionary<string, string>(), new string[0],
            new Dictionary<string, KeyValuePair<string, string>[]>()) == "UNQUALIFIED_COVERAGE_INPUT", "OPC_unsupported_cannot_supply_coverage");
    }
}
