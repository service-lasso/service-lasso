// Memory-only OPC acquisition/coverage inspection. XML/signature inspection is not authentication.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace ServiceLasso.SourceAcquisition
{
    internal interface IOriginalContainerAuthority
    {
        // Genuine NEW reader/source/image/native acquisition: full roster, all ranges/CRC/EOF/aliases,
        // all original869 members/all841 associations and exact archive before any selected byte return.
        void BeforeSelection(OriginalContainer container, string[] exactNames);
        void BeforeArchiveReader(IHeldInput originalArchive, Binding originalClaims, string[] exactNames);
        void ObserveCompleteArchiveResult(Core1681BoundedVsix.Result result, Binding originalClaims);
    }
    internal sealed class OpcSelectedBytes
    {
        internal Core1681BoundedVsix.Result CompleteMetadata;
        internal Dictionary<string, byte[]> Selected;
        internal Binding Archive, Claims;
        internal string State = "FORMAT_OBSERVED_NOT_DISTRIBUTION_AUTHENTICATION";
    }
    internal sealed class OriginalPart
    {
        internal readonly string Name;
        internal readonly Binding DecodedBinding;
        internal readonly Binding OriginalContainerMemberObservation;
        private readonly byte[] bytes;
        internal OriginalPart(string name, Binding decoded, Binding originalObservation, byte[] decodedBytes)
        {
            if (decodedBytes == null || decodedBytes.LongLength > 16777216 || decoded == null ||
                originalObservation == null || !decoded.Matches(decodedBytes)) throw new ArgumentException("PART_BYTE_BINDING");
            Name = name; DecodedBinding = decoded; OriginalContainerMemberObservation = originalObservation;
            bytes = (byte[])decodedBytes.Clone();
        }
        internal byte[] Copy() { return (byte[])bytes.Clone(); }
    }
    internal sealed class OriginalContainer
    {
        internal readonly Binding Archive, CompleteRoster;
        internal readonly OriginalPart[] Parts;
        internal readonly string NativeContainerAuthorityReference;
        private readonly IOriginalContainerAuthority authority;
        internal OriginalContainer(Binding archive, Binding roster, OriginalPart[] parts, string originalAuthority,
            IOriginalContainerAuthority qualifiedSource)
        {
            if (archive == null || roster == null || parts == null || parts.Length == 0 || parts.Length > 100000 ||
                String.IsNullOrEmpty(originalAuthority) || qualifiedSource == null) throw new ArgumentException("CONTAINER_ACQUISITION_UNQUALIFIED");
            long length = 0; var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var part in parts)
            {
                if (part == null || !names.Add(part.Name) || !OpcCoverage.PartUri(part.Name))
                    throw new ArgumentException("AMBIGUOUS_OR_UNSUPPORTED_CONTAINER_MEMBER");
                length = checked(length + part.DecodedBinding.Length);
                if (length > 268435456) throw new Quota("CONTAINER_DECODED");
            }
            Archive = archive; CompleteRoster = roster; Parts = (OriginalPart[])parts.Clone();
            NativeContainerAuthorityReference = originalAuthority;
            authority = qualifiedSource;
        }
        // Caller selection is bounded exact original members; it cannot exclude dependencies from the full roster.
        internal Dictionary<string, byte[]> Select(string[] names)
        {
            if (names == null || names.Length == 0 || names.Length > 128 || names.Distinct(StringComparer.Ordinal).Count() != names.Length)
                throw new ArgumentException("PART_SELECTION_QUOTA_OR_DUPLICATE");
            authority.BeforeSelection(this, (string[])names.Clone());
            var selected = new Dictionary<string, byte[]>(StringComparer.Ordinal); long length = 0;
            foreach (string name in names)
            {
                var matches = Parts.Where(p => p.Name == name).ToArray();
                if (matches.Length != 1) throw new ArgumentException("PART_SELECTION_UNRESOLVED");
                byte[] bytes = matches[0].Copy();
                if (!matches[0].DecodedBinding.Matches(bytes)) throw new ArgumentException("PART_BYTES_CHANGED");
                length += bytes.LongLength; if (length > 16777216) throw new Quota("SELECTED_PARTS");
                selected.Add(name, bytes);
            }
            return selected;
        }
    }
    internal sealed class OpcReference
    {
        internal string Uri, DigestAlgorithm, DigestValue;
        internal string[] Transforms, SourceIds, SourceTypes;
    }
    internal sealed class OpcInspection
    {
        internal string State = "UNQUALIFIED_INPUT", Canonicalization, SignatureAlgorithm;
        internal readonly List<OpcReference> References = new List<OpcReference>();
        internal byte[] OriginalXml;
        internal string[] OriginalIds;
    }
    internal static class OpcCoverage
    {
        internal const string Digest = "http://www.w3.org/2001/04/xmlenc#sha256";
        internal const string Signature = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
        internal const string Canonical = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
        internal const string Relationships = "http://schemas.openxmlformats.org/package/2006/RelationshipTransform";
        private static readonly XNamespace Ds = "http://www.w3.org/2000/09/xmldsig#";
        private static readonly XNamespace Opc = "http://schemas.openxmlformats.org/package/2006/digital-signature";
        internal static bool OriginalMemberName(string name)
        {
            // Exact ZIP roster name, not an XML reference URI. Preserve special [Content_Types].xml.
            if (String.IsNullOrEmpty(name) || name.Length > 4096 || name[0] != '/' || name.Length == 1 ||
                name.IndexOfAny(new[] { '\\', ':', '\0' }) >= 0 || name.Any(Char.IsControl)) return false;
            return name.Substring(1).Split('/').All(segment => segment.Length > 0 && segment != "." && segment != "..");
        }
        internal static OpcSelectedBytes ReadOriginalParts(IHeldInput original, byte[] heldArchiveBytes,
            Core1681BoundedVsix.Claim[] claims, Binding originalClaimBinding, string[] exactNames,
            IOriginalContainerAuthority authority)
        {
            if (original == null || original.OriginalBytes == null || authority == null || originalClaimBinding == null)
                throw new InvalidOperationException("ARCHIVE_SOURCE_NATIVE_AUTHORITY_ABSENT");
            authority.BeforeArchiveReader(original, originalClaimBinding, exactNames);
            original.ObserveBefore();
            try
            {
                if (!original.OriginalBytes.Matches(heldArchiveBytes)) throw new ArgumentException("HELD_ARCHIVE_BYTES_CHANGED");
                Dictionary<string, byte[]> selected;
                var metadata = Core1681BoundedVsix.Observe(heldArchiveBytes, original.OriginalBytes.Length,
                    original.OriginalBytes.Sha256, claims, exactNames, out selected);
                authority.ObserveCompleteArchiveResult(metadata, originalClaimBinding);
                return new OpcSelectedBytes { CompleteMetadata = metadata, Selected = selected,
                    Archive = original.OriginalBytes, Claims = originalClaimBinding };
            }
            finally { original.ObserveAfterOriginalClosure(); GC.KeepAlive(original); }
        }
        internal static bool PartUri(string name)
        {
            if (String.IsNullOrEmpty(name) || name.Length > 4096 || name[0] != '/' || name.Length == 1 ||
                name.IndexOfAny(new[] { '\\', '?', '#', ':' }) >= 0 || name.StartsWith("//", StringComparison.Ordinal)) return false;
            foreach (string segment in name.Substring(1).Split('/'))
            {
                if (segment.Length == 0 || segment == "." || segment == "..") return false;
                string decoded;
                try
                {
                    var encoded = new List<byte>();
                    for (int i = 0; i < segment.Length; i++)
                    {
                        char c = segment[i];
                        if (c == '%')
                        {
                            if (i + 2 >= segment.Length || !Hex(segment[i + 1]) || !Hex(segment[i + 2])) return false;
                            encoded.Add(Convert.ToByte(segment.Substring(i + 1, 2), 16)); i += 2;
                        }
                        else { if (c > 127) return false; encoded.Add((byte)c); }
                    }
                    decoded = new UTF8Encoding(false, true).GetString(encoded.ToArray());
                }
                catch (ArgumentException) { return false; }
                if (decoded == "." || decoded == ".." || decoded.Any(c => Char.IsControl(c)) ||
                    decoded.IndexOfAny(new[] { '/', '\\', '%', '?', '#', ':' }) >= 0 ||
                    !decoded.IsNormalized(NormalizationForm.FormC) || Uri.EscapeDataString(decoded) != segment) return false;
            }
            return true;
        }
        private static bool Hex(char c) { return c >= '0' && c <= '9' || c >= 'A' && c <= 'F'; }
        internal static bool ReferenceUri(string uri, string originalContentType, out string part)
        {
            part = null;
            if (uri == null || originalContentType == null || originalContentType.Length > 1024 ||
                originalContentType.Any(c => Char.IsControl(c) || c == '?' || c == '#' || c == '&')) return false;
            string suffix = "?ContentType=" + originalContentType;
            if (!uri.EndsWith(suffix, StringComparison.Ordinal)) return false;
            part = uri.Substring(0, uri.Length - suffix.Length); return PartUri(part);
        }
        internal static OpcInspection Inspect(byte[] originalXml, IOriginalNativeModule qualifiedXmlRuntime)
        {
            if (qualifiedXmlRuntime == null) throw new InvalidOperationException("XML_RUNTIME_SOURCE_CONSTRUCTOR_ABSENT");
            if (originalXml == null || originalXml.Length == 0 || originalXml.Length > 16777216) throw new Quota("XML");
            var result = new OpcInspection { OriginalXml = (byte[])originalXml.Clone() };
            qualifiedXmlRuntime.BeforeConstructor("OpcCoverage.Inspect", new[] { "XmlReader.Create", "XDocument.Load" });
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                MaxCharactersInDocument = 16777216, MaxCharactersFromEntities = 0, IgnoreWhitespace = false };
            XDocument document;
            using (var stream = new MemoryStream(result.OriginalXml, false))
            using (var reader = XmlReader.Create(stream, settings)) document = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var element in document.Descendants())
            {
                foreach (var attribute in element.Attributes().Where(a => a.Name.LocalName == "Id" || a.Name.LocalName == "ID" || a.Name.LocalName == "id"))
                {
                    if (String.IsNullOrEmpty(attribute.Value) || !ids.Add(attribute.Value))
                    { result.State = "AMBIGUOUS_XML_ID"; return result; }
                }
            }
            result.OriginalIds = ids.ToArray();
            if (document.Root == null || document.Root.Name != Ds + "Signature" ||
                document.Descendants(Ds + "Signature").Count() != 1) { result.State = "UNSUPPORTED_SIGNATURE_STRUCTURE"; return result; }
            var signedInfos = document.Root.Elements(Ds + "SignedInfo").ToArray();
            if (signedInfos.Length != 1) { result.State = "AMBIGUOUS_SIGNED_INFO"; return result; }
            var signed = signedInfos[0];
            var canonical = signed.Elements(Ds + "CanonicalizationMethod").ToArray();
            var signature = signed.Elements(Ds + "SignatureMethod").ToArray();
            if (canonical.Length != 1 || signature.Length != 1) { result.State = "AMBIGUOUS_ALGORITHMS"; return result; }
            result.Canonicalization = (string)canonical[0].Attribute("Algorithm");
            result.SignatureAlgorithm = (string)signature[0].Attribute("Algorithm");
            if (result.Canonicalization != Canonical || canonical[0].HasElements || result.SignatureAlgorithm != Signature || signature[0].HasElements)
            { result.State = "UNSUPPORTED_SIGNATURE_ALGORITHM_OR_CANONICALIZATION"; return result; }
            var references = signed.Elements(Ds + "Reference").Concat(document.Descendants(Ds + "Manifest").Elements(Ds + "Reference")).ToArray();
            if (references.Length == 0 || references.Length > 100000) { result.State = "UNSUPPORTED_REFERENCE_COUNT"; return result; }
            foreach (var reference in references)
            {
                var digest = reference.Elements(Ds + "DigestMethod").ToArray();
                var values = reference.Elements(Ds + "DigestValue").ToArray();
                var transformContainers = reference.Elements(Ds + "Transforms").ToArray();
                if (digest.Length != 1 || values.Length != 1 || transformContainers.Length > 1 || digest[0].HasElements)
                { result.State = "AMBIGUOUS_REFERENCE_STRUCTURE"; return result; }
                // Validate the whole observed container before projecting its roster.
                if (transformContainers.Any(t => t.Attributes().Any(a => !a.IsNamespaceDeclaration) ||
                    t.Elements().Any(e => e.Name != Ds + "Transform") ||
                    t.Nodes().Any(n => !(n is XElement) && !(n is XText) && !(n is XComment)) ||
                    t.Nodes().OfType<XText>().Any(n => !String.IsNullOrWhiteSpace(n.Value))))
                { result.State = "UNSUPPORTED_TRANSFORM_CONTAINER"; return result; }
                var transforms = transformContainers.SelectMany(t => t.Elements(Ds + "Transform")).ToArray();
                var row = new OpcReference { Uri = (string)reference.Attribute("URI"), DigestAlgorithm = (string)digest[0].Attribute("Algorithm"),
                    DigestValue = values[0].Value, Transforms = transforms.Select(t => (string)t.Attribute("Algorithm")).ToArray(),
                    SourceIds = transforms.Where(t => (string)t.Attribute("Algorithm") == Relationships).Elements(Opc + "RelationshipReference").Select(t => (string)t.Attribute("SourceId")).ToArray(),
                    SourceTypes = transforms.Where(t => (string)t.Attribute("Algorithm") == Relationships).Elements(Opc + "RelationshipsGroupReference").Select(t => (string)t.Attribute("SourceType")).ToArray() };
                result.References.Add(row);
                byte[] digestBytes;
                try { digestBytes = Convert.FromBase64String(row.DigestValue); }
                catch (FormatException) { result.State = "INVALID_DIGEST_BYTES"; return result; }
                if (row.DigestAlgorithm != Digest || digestBytes.Length != 32) { result.State = "UNSUPPORTED_DIGEST_ALGORITHM"; return result; }
                bool relation = row.Transforms.SequenceEqual(new[] { Relationships, Canonical });
                if (row.Transforms.Length != 0 && !row.Transforms.SequenceEqual(new[] { Canonical }) && !relation)
                { result.State = "UNSUPPORTED_TRANSFORM_ORDER"; return result; }
                if (transforms.Any(t => (string)t.Attribute("Algorithm") == Canonical ? t.HasElements :
                    (string)t.Attribute("Algorithm") != Relationships || t.Elements().Any(child =>
                        child.Name != Opc + "RelationshipReference" && child.Name != Opc + "RelationshipsGroupReference" ||
                        child.HasElements || child.Attributes().Count(a => !a.IsNamespaceDeclaration) != 1 ||
                        child.Attributes().Any(a => !a.IsNamespaceDeclaration && a.Name !=
                            (child.Name == Opc + "RelationshipReference" ? "SourceId" : "SourceType")))))
                { result.State = "UNSUPPORTED_TRANSFORM_PARAMETERS"; return result; }
                if (relation && (row.SourceIds.Length + row.SourceTypes.Length == 0 || row.SourceIds.Any(String.IsNullOrEmpty) ||
                    row.SourceTypes.Any(String.IsNullOrEmpty) || row.SourceIds.Distinct().Count() != row.SourceIds.Length ||
                    row.SourceTypes.Distinct().Count() != row.SourceTypes.Length))
                { result.State = "AMBIGUOUS_RELATIONSHIP_SELECTORS"; return result; }
            }
            // Actual canonicalization/token/imprint/chain/coverage remain independent; inspection cannot authenticate.
            result.State = "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED"; return result;
        }
        internal static string Coverage(OpcInspection inspection, Dictionary<string, string> contentTypes,
            string[] requiredParts, Dictionary<string, KeyValuePair<string, string>[]> relationships)
        {
            if (inspection == null || inspection.State != "FORMAT_OBSERVED_XML_CRYPTO_UNQUALIFIED" ||
                contentTypes == null || requiredParts == null || relationships == null) return "UNQUALIFIED_COVERAGE_INPUT";
            var covered = new HashSet<string>(StringComparer.Ordinal);
            foreach (var reference in inspection.References)
            {
                string part = null;
                var matches = contentTypes.Where(pair => ReferenceUri(reference.Uri, pair.Value, out part) && part == pair.Key).ToArray();
                if (matches.Length != 1) return "UNSUPPORTED_OR_AMBIGUOUS_REFERENCE_URI";
                part = matches[0].Key;
                if (!covered.Add(part)) return "AMBIGUOUS_PART_COVERAGE";
                if (reference.Transforms.SequenceEqual(new[] { Relationships, Canonical }))
                {
                    KeyValuePair<string, string>[] rows;
                    if (!relationships.TryGetValue(part, out rows) || rows == null || rows.Length > 100000 ||
                        rows.Select(r => r.Key).Distinct(StringComparer.Ordinal).Count() != rows.Length)
                        return "UNQUALIFIED_RELATIONSHIP_ROSTER";
                    if (reference.SourceIds.Any(id => rows.Count(row => row.Key == id) != 1) ||
                        reference.SourceTypes.Any(type => !rows.Any(row => row.Value == type))) return "UNRESOLVED_RELATIONSHIP_SELECTOR";
                }
            }
            if (requiredParts.Any(part => !PartUri(part) || !covered.Contains(part))) return "UNCOVERED_REQUIRED_PART";
            return "COVERAGE_STRUCTURALLY_OBSERVED_CRYPTO_UNQUALIFIED";
        }
    }
}
