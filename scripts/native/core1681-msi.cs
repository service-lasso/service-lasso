// Fixed readonly MSI source adapter; not wired into a loader or executable.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace ServiceLasso.SourceAcquisition
{
    internal sealed class MsiExports
    {
        private static readonly string[] fixedRoster = { "MsiOpenDatabaseW", "MsiDatabaseOpenViewW", "MsiViewExecute",
            "MsiViewFetch", "MsiViewGetColumnInfo", "MsiRecordGetFieldCount", "MsiRecordIsNull", "MsiRecordGetInteger",
            "MsiRecordGetStringW", "MsiRecordReadStream", "MsiGetSummaryInformationW", "MsiSummaryInfoGetPropertyW",
            "MsiGetLastErrorRecord", "MsiViewClose", "MsiCloseHandle" };
        internal static string[] Roster { get { return (string[])fixedRoster.Clone(); } }
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        internal delegate uint OpenDatabase([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr readonlyMode, out uint database);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        internal delegate uint OpenView(uint database, [MarshalAs(UnmanagedType.LPWStr)] string query, out uint view);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate uint Execute(uint view, uint record);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate uint Fetch(uint view, out uint record);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate uint ColumnInfo(uint view, uint kind, out uint record);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate uint FieldCount(uint record);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate int IsNull(uint record, uint field);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate int Integer(uint record, uint field);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        internal delegate uint StringValue(uint record, uint field, [Out] StringBuilder value, ref uint codeUnits);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        internal delegate uint StreamValue(uint record, uint field, [Out] byte[] bytes, ref uint count);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        internal delegate uint Summary(uint database, [MarshalAs(UnmanagedType.LPWStr)] string path, uint updates, out uint summary);
        [StructLayout(LayoutKind.Sequential)] internal struct FileTime { internal uint Low, High; }
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        internal delegate uint SummaryValue(uint summary, uint property, out uint type, out int integer,
            out FileTime time, [Out] StringBuilder text, ref uint codeUnits);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate uint LastError();
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate uint Close(uint handle);
        internal readonly OpenDatabase Database;
        internal readonly OpenView View;
        internal readonly Execute Run;
        internal readonly Fetch Next;
        internal readonly ColumnInfo Columns;
        internal readonly FieldCount Count;
        internal readonly IsNull Null;
        internal readonly Integer Int;
        internal readonly StringValue Text;
        internal readonly StreamValue Stream;
        internal readonly Summary SummaryInfo;
        internal readonly SummaryValue SummaryProperty;
        internal readonly LastError Error;
        internal readonly Close ViewClose, HandleClose;
        internal readonly IOriginalNativeModule Module;
        internal MsiExports(IOriginalNativeModule module)
        {
            if (module == null) throw new InvalidOperationException("NATIVE_MODULE_AUTHORITY_ABSENT");
            Module = module; module.BeforeConstructor("MsiExports..ctor", (string[])Roster.Clone());
            Database = Bind<OpenDatabase>(Roster[0]); View = Bind<OpenView>(Roster[1]); Run = Bind<Execute>(Roster[2]);
            Next = Bind<Fetch>(Roster[3]); Columns = Bind<ColumnInfo>(Roster[4]); Count = Bind<FieldCount>(Roster[5]);
            Null = Bind<IsNull>(Roster[6]); Int = Bind<Integer>(Roster[7]); Text = Bind<StringValue>(Roster[8]);
            Stream = Bind<StreamValue>(Roster[9]); SummaryInfo = Bind<Summary>(Roster[10]);
            SummaryProperty = Bind<SummaryValue>(Roster[11]); Error = Bind<LastError>(Roster[12]);
            ViewClose = Bind<Close>(Roster[13]); HandleClose = Bind<Close>(Roster[14]);
        }
        private T Bind<T>(string name) where T : class
        {
            Module.BeforeCall("MsiExports.Bind", "Marshal.GetDelegateForFunctionPointer", name);
            IntPtr address = Module.OriginalExport(name);
            if (address == IntPtr.Zero) throw new InvalidOperationException("NATIVE_EXPORT_ABSENT:" + name);
            return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
        }
    }
    internal enum CellKind { Null, Integer, String, Stream, Unresolved }
    internal sealed class MsiCell
    {
        internal CellKind Kind;
        internal int? Integer;
        internal string Text, Unresolved;
        internal byte[][] StreamChunks;
        internal long StreamLength;
        internal string StreamSha256;
        internal uint[] StreamStatuses;
        internal MsiCell(CellKind kind) { Kind = kind; }
    }
    internal sealed class MsiTable
    {
        internal string Name, State;
        internal string[] Names, Types;
        internal readonly List<MsiCell[]> Rows = new List<MsiCell[]>();
    }
    internal sealed class SummaryCell
    {
        internal uint Property, Type, Status;
        internal int Integer;
        internal MsiExports.FileTime Time;
        internal string Text;
    }
    internal sealed class MsiReceipt
    {
        internal readonly string Recipe = "MSI-READONLY-ROWS-1";
        internal readonly List<MsiTable> Tables = new List<MsiTable>();
        internal readonly List<SummaryCell> Summary = new List<SummaryCell>();
        internal readonly List<NativeResource> Resources = new List<NativeResource>();
        internal readonly List<NativeObservation> Observations = new List<NativeObservation>();
        internal Binding HeldMsi;
        internal string DatabaseAssociation = "DATABASE_OBJECT_ASSOCIATION_UNQUALIFIED";
        internal string InstalledContext = "UNRESOLVED_INSTALL_BRANCH";
        internal string Eligibility = "UNQUALIFIED_INPUT";
        internal Exception OriginalException;
    }
    internal sealed class MsiReadOnly
    {
        private static readonly string[] fixedTables = { "_Tables", "_Columns", "Property", "Feature", "FeatureComponents",
            "Condition", "Component", "Directory", "File", "Media", "MsiFileHash", "MsiDigitalSignature",
            "MsiDigitalCertificate", "_Streams", "InstallExecuteSequence", "InstallUISequence",
            "AdminExecuteSequence", "AdminUISequence", "AdvtExecuteSequence", "CustomAction" };
        internal static string[] Tables { get { return (string[])fixedTables.Clone(); } }
        private readonly MsiExports api;
        private readonly IHeldInput held;
        private readonly Budget budget = new Budget();
        private readonly MsiReceipt receipt = new MsiReceipt();
        private bool closing;
        private bool capturingExtendedError;
        private object pendingCall;
        internal MsiReceipt CurrentReceipt { get { return receipt; } }
        internal MsiReadOnly(MsiExports exports, IHeldInput input)
        {
            if (exports == null || input == null || input.OriginalBytes == null || input.OriginalReadableHandle == IntPtr.Zero ||
                input.OriginalReadableHandle == new IntPtr(-1) || String.IsNullOrEmpty(input.NativeObjectReference))
                throw new ArgumentException("HELD_MSI_UNQUALIFIED");
            api = exports; held = input; receipt.HeldMsi = input.OriginalBytes;
        }
        private void Before(string operation, string token)
        { api.Module.BeforeCall("MsiReadOnly", operation, token); }
        private T Call<T>(string operation, Func<T> originalCall)
        {
            pendingCall = originalCall;
            try { T result = originalCall(); pendingCall = null; return result; }
            catch (Exception original)
            {
                receipt.Observations.Add(new NativeObservation(receipt.Observations.Count + 1, operation + ":unknown-return", -1, null, original));
                // A marshaling/interop exception is not evidence that the native call acquired nothing.
                GC.KeepAlive(pendingCall);
                Lifetime.Retain(api.Module, this, "UNKNOWN_ORIGINAL_MSI_CALL_RETURN"); throw;
            }
        }
        private NativeResource Own(string kind, uint handle, bool view = false)
        {
            if (handle == 0) return null;
            var resource = new NativeResource(receipt.Resources.Count + 1, kind, handle, view);
            receipt.Resources.Add(resource); return resource;
        }
        private void Observe(string operation, uint status, bool error = true)
        {
            // Store initiating operation/status before acquiring the extended native error record.
            var original = new NativeObservation(receipt.Observations.Count + 1, operation, status, null, null);
            receipt.Observations.Add(original);
            if (error && !capturingExtendedError && status != 0 && status != 234 && status != 259)
                CaptureExtendedError(operation, status);
            api.Module.ObserveOriginalCall(operation, status);
            budget.Charge(128);
        }
        private void CaptureExtendedError(string operation, uint status)
        {
            // The original failed owner stays in receipt.Resources. Error-record cleanup
            // must never acquire another error record before that owner is retained.
            capturingExtendedError = true;
            try { CaptureOneExtendedError(operation, status); }
            finally { capturingExtendedError = false; }
        }
        private void CaptureOneExtendedError(string operation, uint status)
        {
            Before("MsiGetLastErrorRecord", operation);
            uint handle = Call("MsiGetLastErrorRecord", () => api.Error());
            NativeResource resource = Own("extended-error-record", handle);
            if (handle == 0) return;
            var fields = new List<MsiErrorField>();
            try
            {
                uint count = FieldCount(handle);
                for (uint field = 0; field <= count; field++)
                {
                    Before("MsiRecordIsNull", "error:" + field);
                    int isNull = Call("MsiRecordIsNull", () => api.Null(handle, field));
                    var cell = new MsiErrorField { Ordinal = field, OriginalIsNull = isNull != 0,
                        TypeDisposition = isNull != 0 ? "NULL" : "UNRESOLVED_ERROR_RECORD_TYPE" };
                    fields.Add(cell);
                    if (isNull == 0)
                    {
                        Before("MsiRecordGetInteger", "error:" + field);
                        cell.OriginalIntegerGetter = Call("MsiRecordGetInteger", () => api.Int(handle, field));
                        cell.OriginalStringGetter = ReadText(handle, field, false);
                    }
                }
                receipt.Observations.Add(new NativeObservation(receipt.Observations.Count + 1,
                    operation + ":extended-error", status, fields.ToArray(), null));
            }
            finally { Release(resource); }
        }
        private uint FieldCount(uint record)
        {
            Before("MsiRecordGetFieldCount", record.ToString());
            uint count = Call("MsiRecordGetFieldCount", () => api.Count(record));
            if (count > 64) throw new Quota("FIELDS");
            return count;
        }
        internal static bool SupportedDescriptor(string descriptor)
        {
            if (String.IsNullOrEmpty(descriptor) || descriptor.Length > 4) return false;
            char tag = Char.ToLowerInvariant(descriptor[0]);
            string width = descriptor.Substring(1);
            if (tag == 'i') return width == "2" || width == "4";
            if (tag == 'v') return width == "0";
            if (tag != 's' || width.Length == 0 || width.Any(c => c < '0' || c > '9') ||
                (width.Length > 1 && width[0] == '0')) return false;
            int size; return Int32.TryParse(width, out size) && size <= 255;
        }
        private string ReadText(uint record, uint field, bool capture = true)
        {
            uint count = 0;
            Before("MsiRecordGetStringW", "length:" + record + ":" + field);
            uint status = Call("MsiRecordGetStringW", () => api.Text(record, field, null, ref count));
            Observe("MsiRecordGetStringW:length", status, capture);
            if (status != 0 && status != 234) throw new InvalidOperationException("STRING_READ_FAILED:" + status);
            if (count > 1048576) throw new Quota("STRING");
            budget.Charge(count * 12L + 128); // Conservative escaped UTF16 JSON and original memory.
            var text = new StringBuilder(checked((int)count + 1));
            uint available = count + 1;
            Before("MsiRecordGetStringW", "value:" + record + ":" + field);
            status = Call("MsiRecordGetStringW", () => api.Text(record, field, text, ref available));
            Observe("MsiRecordGetStringW:value", status, capture);
            if (status != 0 || available != count || text.Length != count)
                throw new InvalidOperationException("STRING_CHANGED_OR_TRUNCATED:" + status);
            return text.ToString();
        }
        private string[] Info(uint view, uint kind)
        {
            uint record = 0;
            Before("MsiViewGetColumnInfo", kind.ToString());
            uint status = Call("MsiViewGetColumnInfo", () => api.Columns(view, kind, out record));
            var resource = Own("column-info-" + kind, record);
            try
            {
                Observe("MsiViewGetColumnInfo", status);
                if (status != 0 || record == 0) throw new InvalidOperationException("UNRESOLVED_SCHEMA");
                uint count = FieldCount(record);
                if (count == 0) throw new InvalidOperationException("UNRESOLVED_SCHEMA");
                var values = new string[count];
                for (uint field = 1; field <= count; field++) values[field - 1] = ReadText(record, field);
                return values;
            }
            finally { Release(resource); }
        }
        private MsiCell Cell(uint record, uint field, string descriptor)
        {
            Before("MsiRecordIsNull", record + ":" + field);
            if (Call("MsiRecordIsNull", () => api.Null(record, field)) != 0) return new MsiCell(CellKind.Null);
            switch (Char.ToLowerInvariant(descriptor[0]))
            {
                case 'i':
                    Before("MsiRecordGetInteger", record + ":" + field);
                    int integer = Call("MsiRecordGetInteger", () => api.Int(record, field));
                    if (integer == Int32.MinValue) return new MsiCell(CellKind.Unresolved) { Unresolved = "MSI_NULL_INTEGER_WITH_NON_NULL_OBSERVATION" };
                    budget.Charge(64); return new MsiCell(CellKind.Integer) { Integer = integer };
                case 's': return new MsiCell(CellKind.String) { Text = ReadText(record, field) };
                case 'v': return ReadStream(record, field);
                default: return new MsiCell(CellKind.Unresolved) { Unresolved = "UNRESOLVED_SCHEMA" };
            }
        }
        private MsiCell ReadStream(uint record, uint field)
        {
            var chunks = new List<byte[]>(); var statuses = new List<uint>(); long total = 0;
            using (var sha = SHA256.Create())
            {
                for (int index = 0; index <= 256; index++)
                {
                    byte[] chunk = new byte[65536]; uint count = 65536;
                    Before("MsiRecordReadStream", record + ":" + field + ":" + index + ":" + total);
                    uint status = Call("MsiRecordReadStream", () => api.Stream(record, field, chunk, ref count));
                    statuses.Add(status); Observe("MsiRecordReadStream", status);
                    if (status != 0 || count > 65536) throw new InvalidOperationException("STREAM_READ_FAILED:" + status);
                    if (count == 0)
                    {
                        sha.TransformFinalBlock(new byte[0], 0, 0);
                        return new MsiCell(CellKind.Stream) { StreamChunks = chunks.ToArray(), StreamLength = total,
                            StreamSha256 = BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant(), StreamStatuses = statuses.ToArray() };
                    }
                    if (count > 16777216 - total) throw new Quota("STREAM");
                    budget.Stream((int)count); total += count;
                    byte[] exact = new byte[count]; Array.Copy(chunk, exact, count); chunks.Add(exact);
                    sha.TransformBlock(exact, 0, exact.Length, null, 0);
                }
                throw new Quota("STREAM_CHUNKS");
            }
        }
        private void Release(NativeResource resource)
        {
            if (resource == null || resource.CloseStatus.HasValue) return;
            try
            {
                if (resource.View)
                {
                    Before("MsiViewClose", resource.Ordinal.ToString());
                    uint viewStatus = Call("MsiViewClose", () => api.ViewClose(resource.Handle));
                    Observe("MsiViewClose", viewStatus);
                    if (viewStatus != 0) Lifetime.Retain(api.Module, this, "FAILED_ORIGINAL_VIEW_CLOSE");
                }
                Before("MsiCloseHandle", resource.Ordinal.ToString());
                uint status = Call("MsiCloseHandle", () => api.HandleClose(resource.Handle));
                resource.CloseStatus = status;
                Observe("MsiCloseHandle", status);
                if (status != 0) Lifetime.Retain(api.Module, this, "FAILED_ORIGINAL_HANDLE_CLOSE");
            }
            catch (Exception original)
            {
                receipt.Observations.Add(new NativeObservation(receipt.Observations.Count + 1,
                    "resource-close-exception", -1, null, original));
                Lifetime.Retain(api.Module, this, "UNKNOWN_ORIGINAL_HANDLE_CLOSE");
            }
        }
        private void ReadTable(uint database, string name)
        {
            var table = new MsiTable { Name = name, State = "TABLE_ERROR" }; receipt.Tables.Add(table);
            uint view = 0;
            Before("MsiDatabaseOpenViewW", "SELECT * FROM `" + name + "`");
            uint status = Call("MsiDatabaseOpenViewW", () => api.View(database, "SELECT * FROM `" + name + "`", out view));
            var resource = Own("view:" + name, view, true);
            try
            {
                Observe("MsiDatabaseOpenViewW", status);
                if (status != 0 || view == 0) return;
                table.Names = Info(view, 0); table.Types = Info(view, 1);
                if (table.Names.Length != table.Types.Length || table.Names.Distinct(StringComparer.Ordinal).Count() != table.Names.Length ||
                    table.Types.Any(t => !SupportedDescriptor(t))) { table.State = "UNRESOLVED_SCHEMA"; return; }
                Before("MsiViewExecute", name + ":parameterRecord=NULL");
                status = Call("MsiViewExecute", () => api.Run(view, 0)); Observe("MsiViewExecute", status);
                if (status != 0) return;
                for (long row = 1; row <= 100001; row++)
                {
                    uint record = 0;
                    Before("MsiViewFetch", name + ":" + row);
                    status = Call("MsiViewFetch", () => api.Next(view, out record));
                    var recordResource = Own("row:" + name + ":" + row, record);
                    try
                    {
                        Observe("MsiViewFetch", status);
                        if (status == 259 && record == 0) { table.State = "ROWS_OBSERVED"; return; }
                        if (status != 0 || record == 0) return;
                        budget.Row(row);
                        if (FieldCount(record) != table.Types.Length) { table.State = "UNRESOLVED_SCHEMA"; return; }
                        var cells = new MsiCell[table.Types.Length];
                        for (uint field = 1; field <= cells.Length; field++) cells[field - 1] = Cell(record, field, table.Types[field - 1]);
                        table.Rows.Add(cells);
                    }
                    finally { Release(recordResource); }
                }
                throw new Quota("TABLE_ROWS");
            }
            finally { Release(resource); }
        }
        private void JoinSchema()
        {
            MsiTable schema = receipt.Tables.Single(t => t.Name == "_Columns");
            MsiTable catalog = receipt.Tables.Single(t => t.Name == "_Tables");
            if (schema.State != "ROWS_OBSERVED" || catalog.State != "ROWS_OBSERVED" ||
                !schema.Names.SequenceEqual(new[] { "Table", "Number", "Name" }) ||
                !catalog.Names.SequenceEqual(new[] { "Name" }) ||
                schema.Types.Any(t => !SupportedDescriptor(t)))
            { foreach (var table in receipt.Tables) table.State = "UNRESOLVED_SCHEMA"; return; }
            var tableNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in catalog.Rows)
            {
                if (row.Length != 1 || row[0].Kind != CellKind.String || !tableNames.Add(row[0].Text))
                { foreach (var table in receipt.Tables) table.State = "UNRESOLVED_SCHEMA"; return; }
            }
            foreach (var table in receipt.Tables)
            {
                // System catalogs need not themselves occur in _Tables/_Columns; their documented schema is explicit.
                if (table.Name == "_Tables" || table.Name == "_Columns") continue;
                if (!tableNames.Contains(table.Name))
                { table.State = table.State == "TABLE_ERROR" ? "TABLE_ABSENT" : "UNRESOLVED_SCHEMA"; continue; }
                var definitions = schema.Rows.Where(r => r.Length == 3 && r[0].Kind == CellKind.String && r[0].Text == table.Name).ToArray();
                if (table.Names == null || definitions.Length != table.Names.Length) { table.State = "UNRESOLVED_SCHEMA"; continue; }
                for (int field = 1; field <= table.Names.Length; field++)
                {
                    var matches = definitions.Where(r => r[1].Kind == CellKind.Integer && r[1].Integer == field &&
                        r[2].Kind == CellKind.String && r[2].Text == table.Names[field - 1]).ToArray();
                    if (matches.Length != 1) { table.State = "UNRESOLVED_SCHEMA"; break; }
                }
            }
        }
        private void ReadSummary(uint database)
        {
            uint summary = 0;
            Before("MsiGetSummaryInformationW", "held-database:updates=0:path=NULL");
            uint status = Call("MsiGetSummaryInformationW", () => api.SummaryInfo(database, null, 0, out summary));
            var resource = Own("summary", summary);
            try
            {
                Observe("MsiGetSummaryInformationW", status);
                if (status != 0 || summary == 0) return;
                for (uint property = 1; property <= 19; property++)
                {
                    uint type = 0, count = 0; int integer = 0; MsiExports.FileTime time = new MsiExports.FileTime();
                    Before("MsiSummaryInfoGetPropertyW", property + ":length");
                    status = Call("MsiSummaryInfoGetPropertyW", () => api.SummaryProperty(summary, property, out type, out integer, out time, null, ref count));
                    Observe("MsiSummaryInfoGetPropertyW:length", status);
                    var cell = new SummaryCell { Property = property, Type = type, Status = status, Integer = integer, Time = time };
                    receipt.Summary.Add(cell);
                    if (status != 0 && status != 234) continue;
                    if (count > 1048576) throw new Quota("SUMMARY_STRING");
                    budget.Charge(count * 12L + 128);
                    var text = new StringBuilder(checked((int)count + 1)); uint capacity = count + 1;
                    uint finalType = 0; int finalInteger = 0; MsiExports.FileTime finalTime = new MsiExports.FileTime();
                    Before("MsiSummaryInfoGetPropertyW", property + ":value");
                    status = Call("MsiSummaryInfoGetPropertyW", () => api.SummaryProperty(summary, property, out finalType, out finalInteger, out finalTime, text, ref capacity));
                    Observe("MsiSummaryInfoGetPropertyW:value", status);
                    cell.Status = status;
                    if (status != 0 || finalType != type || finalInteger != integer || finalTime.Low != time.Low ||
                        finalTime.High != time.High || capacity != count || text.Length != count)
                        throw new InvalidOperationException("SUMMARY_CHANGED_OR_TRUNCATED");
                    cell.Text = text.ToString();
                }
            }
            finally { Release(resource); }
        }
        internal MsiReceipt Read()
        {
            if (closing) throw new InvalidOperationException("OWNER_ALREADY_ENTERED"); closing = true;
            held.ObserveBefore(); uint database = 0; NativeResource resource = null;
            try
            {
                Before("MsiOpenDatabaseW", "MSIDBOPEN_READONLY:" + held.OriginalPath);
                uint status = Call("MsiOpenDatabaseW", () => api.Database(held.OriginalPath, IntPtr.Zero, out database));
                resource = Own("database", database); Observe("MsiOpenDatabaseW", status);
                if (status != 0 || database == 0) return receipt;
                string association = held.OriginalDatabaseAssociation(database, api.Module);
                receipt.DatabaseAssociation = String.IsNullOrEmpty(association) ? "DATABASE_OBJECT_ASSOCIATION_UNQUALIFIED" : association;
                foreach (string table in Tables) ReadTable(database, table);
                JoinSchema(); ReadSummary(database);
                // Installed context/cabinet/source/association are not supplied by these table observations.
                receipt.Eligibility = "FORMAT_OBSERVED_JOIN_UNQUALIFIED";
                return receipt;
            }
            catch (Exception original)
            {
                receipt.OriginalException = original; receipt.Eligibility = "UNQUALIFIED_INPUT";
                api.Module.ObserveOriginalException("MsiReadOnly.Read", original); return receipt;
            }
            finally
            {
                Release(resource);
                held.ObserveAfterOriginalClosure();
                GC.KeepAlive(held); GC.KeepAlive(api);
            }
        }
    }
}
