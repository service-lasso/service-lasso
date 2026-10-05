// Prospective AC-4DI.4 cases, UNRUN. Synthetic source cases do not supply native authority.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
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
        byte[] corrupt = (byte[])archive.Clone(); corrupt[full.Members[0].DataOffset] ^= 1;
        bool crc = false;
        try { Core1681BoundedVsix.Observe(corrupt, corrupt.Length, Convert.ToHexString(SHA256.HashData(corrupt)), claims,
            new[] { "/metadata/part0.xml" }, out selected); }
        catch (InvalidDataException original) { crc = original.Message == "CRC mismatch"; }
        Expect(crc, "PART_changed_bytes_resealed_archive_hits_CRC");
        bool missing = false;
        try { Core1681BoundedVsix.Observe(archive, archive.Length, Convert.ToHexString(SHA256.HashData(archive)), claims,
            new[] { "/metadata/missing.xml" }, out selected); }
        catch (InvalidDataException original) { missing = original.Message == "selected member missing"; }
        Expect(missing, "PART_missing_selected_not_empty_success");
    }
    // Direct original native cases need genuine separately admitted module, held package, database association,
    // anchors and installed branch. This entrypoint fabricates none and does not bypass missing resources.
    internal static void ObserveOriginalNative(MsiExports msi, WintrustExports trust, IHeldInput original,
        RootPolicyInput roots, IIndependentChainObserver chains)
    {
        var rows = new MsiReadOnly(msi, original).Read();
        Expect(rows.Tables.Count == 20 && rows.Tables.Any(t => t.Name == "Property" && t.State == "ROWS_OBSERVED"), "MSI_original_native_positive");
        Expect(rows.Resources.All(resource => resource.CloseStatus == 0), "MSI_actual_original_resource_close");
        Expect(rows.InstalledContext == "UNRESOLVED_INSTALL_BRANCH" && rows.Eligibility != "AUTHENTICATED_DISTRIBUTION", "MSI_no_invented_installed_join");
        var signature = new OfflineAuthenticode(trust, original, roots, chains).Read();
        Expect(signature.CountObservation != null && signature.Signatures.Count > 0 && signature.Signatures.Count <= 32,
            "TRUST_original_finite_signature_roster");
        Expect(signature.Signatures.All(row => row.CloseStatus == 0), "TRUST_each_original_VERIFY_CLOSE");
        Expect(signature.State != "AUTHENTICATED_DISTRIBUTION", "TRUST_provider_not_independent_authentication");
    }
}
