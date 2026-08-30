using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

internal static class ServiceLassoWindowsProcessInspector
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint ProcessVmRead = 0x0010;
    private const uint SnapshotProcesses = 0x00000002;
    private const int ErrorNoMoreFiles = 18;
    private const int ErrorInvalidParameter = 87;
    private const int ProcessCommandLineInformation = 60;
    private const int ProcessBasicInformation = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint ThreadCount;
        public uint ParentProcessId;
        public int BasePriority;
        public uint Flags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ExecutableName;
    }

    private sealed class SnapshotRow
    {
        public int ProcessId;
        public int ParentProcessId;
    }

    private sealed class ProcessEvidence
    {
        public int ProcessId;
        public int ParentProcessId;
        public string CreationDate;
        public string ExecutablePath;
        public string CommandLine;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetProcessId(IntPtr processHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(
        IntPtr processHandle,
        out FileTime creationTime,
        out FileTime exitTime,
        out FileTime kernelTime,
        out FileTime userTime);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(
        IntPtr processHandle,
        uint flags,
        StringBuilder executablePath,
        ref uint executablePathLength);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int informationClass,
        IntPtr information,
        int informationLength,
        out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);

    private static long FileTimeValue(FileTime value)
    {
        return ((long)value.High << 32) | value.Low;
    }

    private static string ReadCommandLine(IntPtr processHandle)
    {
        int requiredLength;
        NtQueryInformationProcess(
            processHandle,
            ProcessCommandLineInformation,
            IntPtr.Zero,
            0,
            out requiredLength);
        int headerSize = IntPtr.Size == 8 ? 16 : 8;
        if (requiredLength < headerSize || requiredLength > 1024 * 1024)
        {
            throw new InvalidOperationException("Native process command line length was invalid.");
        }

        IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
        try
        {
            int returnedLength;
            int status = NtQueryInformationProcess(
                processHandle,
                ProcessCommandLineInformation,
                buffer,
                requiredLength,
                out returnedLength);
            if (status != 0 || returnedLength < headerSize || returnedLength > requiredLength)
            {
                throw new InvalidOperationException("Native process command line query failed.");
            }

            ushort length = unchecked((ushort)Marshal.ReadInt16(buffer, 0));
            ushort maximumLength = unchecked((ushort)Marshal.ReadInt16(buffer, 2));
            int pointerOffset = IntPtr.Size == 8 ? 8 : 4;
            IntPtr valuePointer = Marshal.ReadIntPtr(buffer, pointerOffset);
            long bufferStart = buffer.ToInt64();
            long bufferEnd = bufferStart + returnedLength;
            long valueStart = valuePointer.ToInt64();
            if (valueStart < bufferStart + headerSize || valueStart >= bufferEnd)
            {
                throw new InvalidOperationException("Native process command line evidence was invalid.");
            }

            long availableLength = returnedLength - (valueStart - bufferStart);
            if (
                length == 0 ||
                length % 2 != 0 ||
                maximumLength % 2 != 0 ||
                length > maximumLength ||
                length > availableLength ||
                maximumLength > availableLength)
            {
                throw new InvalidOperationException("Native process command line evidence was invalid.");
            }

            string commandLine = Marshal.PtrToStringUni(valuePointer, length / 2);
            if (String.IsNullOrWhiteSpace(commandLine))
            {
                throw new InvalidOperationException("Native process command line was empty.");
            }
            return commandLine;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static int ReadParentProcessId(IntPtr processHandle)
    {
        int informationSize = IntPtr.Size == 8 ? 48 : 24;
        int parentOffset = IntPtr.Size == 8 ? 40 : 20;
        IntPtr information = Marshal.AllocHGlobal(informationSize);
        try
        {
            int returnedLength;
            int status = NtQueryInformationProcess(
                processHandle,
                ProcessBasicInformation,
                information,
                informationSize,
                out returnedLength);
            if (status != 0 || returnedLength < informationSize || returnedLength > informationSize)
            {
                throw new InvalidOperationException("Native process parent query failed.");
            }
            long parentProcessId = Marshal.ReadIntPtr(information, parentOffset).ToInt64();
            if (parentProcessId < 0 || parentProcessId > Int32.MaxValue)
            {
                throw new InvalidOperationException("Native process parent evidence was invalid.");
            }
            return (int)parentProcessId;
        }
        finally
        {
            Marshal.FreeHGlobal(information);
        }
    }

    private static ProcessEvidence ReadProcessEvidence(int targetProcessId)
    {
        IntPtr processHandle = OpenProcess(
            ProcessQueryLimitedInformation | ProcessVmRead,
            false,
            targetProcessId);
        if (processHandle == IntPtr.Zero)
        {
            int openError = Marshal.GetLastWin32Error();
            if (openError == ErrorInvalidParameter)
            {
                return null;
            }
            throw new Win32Exception(openError, "Native process open failed.");
        }

        try
        {
            if (GetProcessId(processHandle) != targetProcessId)
            {
                throw new InvalidOperationException("Native process ID changed.");
            }

            FileTime creationTime;
            FileTime exitTime;
            FileTime kernelTime;
            FileTime userTime;
            if (!GetProcessTimes(processHandle, out creationTime, out exitTime, out kernelTime, out userTime))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Native process time query failed.");
            }

            StringBuilder executablePath = new StringBuilder(32768);
            uint executablePathLength = (uint)executablePath.Capacity;
            if (!QueryFullProcessImageName(processHandle, 0, executablePath, ref executablePathLength) || executablePathLength == 0)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Native process image query failed.");
            }

            return new ProcessEvidence
            {
                ProcessId = targetProcessId,
                ParentProcessId = ReadParentProcessId(processHandle),
                CreationDate = DateTime.FromFileTimeUtc(FileTimeValue(creationTime)).ToString("o", CultureInfo.InvariantCulture),
                ExecutablePath = executablePath.ToString(),
                CommandLine = ReadCommandLine(processHandle)
            };
        }
        finally
        {
            if (!CloseHandle(processHandle))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Native process handle close failed.");
            }
        }
    }

    private static List<SnapshotRow> ReadProcessSnapshot()
    {
        IntPtr snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Native process snapshot failed.");
        }

        try
        {
            List<SnapshotRow> rows = new List<SnapshotRow>();
            ProcessEntry32 entry = new ProcessEntry32();
            entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
            bool present = Process32First(snapshot, ref entry);
            while (present)
            {
                if (entry.ProcessId > 0 && entry.ProcessId <= Int32.MaxValue && entry.ParentProcessId <= Int32.MaxValue)
                {
                    rows.Add(new SnapshotRow
                    {
                        ProcessId = (int)entry.ProcessId,
                        ParentProcessId = (int)entry.ParentProcessId
                    });
                }
                entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
                present = Process32Next(snapshot, ref entry);
            }
            int enumerationError = Marshal.GetLastWin32Error();
            if (enumerationError != ErrorNoMoreFiles)
            {
                throw new Win32Exception(enumerationError, "Native process snapshot enumeration failed.");
            }
            return rows;
        }
        finally
        {
            if (!CloseHandle(snapshot))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Native process snapshot handle close failed.");
            }
        }
    }

    private static List<SnapshotRow> SelectDescendants(int rootProcessId, List<SnapshotRow> rows)
    {
        Dictionary<int, List<SnapshotRow>> childrenByParent = new Dictionary<int, List<SnapshotRow>>();
        foreach (SnapshotRow row in rows)
        {
            List<SnapshotRow> children;
            if (!childrenByParent.TryGetValue(row.ParentProcessId, out children))
            {
                children = new List<SnapshotRow>();
                childrenByParent.Add(row.ParentProcessId, children);
            }
            children.Add(row);
        }

        List<SnapshotRow> descendants = new List<SnapshotRow>();
        HashSet<int> visited = new HashSet<int>();
        Queue<int> queue = new Queue<int>();
        visited.Add(rootProcessId);
        queue.Enqueue(rootProcessId);
        while (queue.Count > 0)
        {
            int parentProcessId = queue.Dequeue();
            List<SnapshotRow> children;
            if (!childrenByParent.TryGetValue(parentProcessId, out children))
            {
                continue;
            }
            foreach (SnapshotRow child in children)
            {
                if (visited.Add(child.ProcessId))
                {
                    descendants.Add(child);
                    queue.Enqueue(child.ProcessId);
                }
            }
        }
        return descendants;
    }

    private static string JsonString(string value)
    {
        StringBuilder output = new StringBuilder();
        output.Append('"');
        foreach (char character in value)
        {
            switch (character)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break;
                case '\f': output.Append("\\f"); break;
                case '\n': output.Append("\\n"); break;
                case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if (character < 0x20)
                    {
                        output.Append("\\u");
                        output.Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        output.Append(character);
                    }
                    break;
            }
        }
        output.Append('"');
        return output.ToString();
    }

    private static string ProcessJson(ProcessEvidence evidence)
    {
        return "{" +
            "\"Status\":\"running\"," +
            "\"ProcessId\":" + evidence.ProcessId.ToString(CultureInfo.InvariantCulture) + "," +
            "\"CreationDate\":" + JsonString(evidence.CreationDate) + "," +
            "\"ExecutablePath\":" + JsonString(evidence.ExecutablePath) + "," +
            "\"CommandLine\":" + JsonString(evidence.CommandLine) + "," +
            "\"ParentProcessId\":" + evidence.ParentProcessId.ToString(CultureInfo.InvariantCulture) +
            "}";
    }

    private static string TreeJson(ProcessEvidence root, List<ProcessEvidence> processes)
    {
        StringBuilder output = new StringBuilder();
        output.Append("{\"Status\":\"tree\",\"RootStatus\":");
        output.Append(root == null ? "\"not_running\"" : "\"running\"");
        output.Append(",\"Processes\":[");
        for (int index = 0; index < processes.Count; index++)
        {
            if (index > 0)
            {
                output.Append(',');
            }
            output.Append(ProcessJson(processes[index]));
        }
        output.Append("]}");
        return output.ToString();
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        int targetProcessId;
        if (args.Length < 1 || !Int32.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out targetProcessId) || targetProcessId <= 0)
        {
            return 2;
        }
        bool includeDescendants = args.Length > 1 &&
            (String.Equals(args[1], "--include-descendants", StringComparison.Ordinal) ||
             String.Equals(args[1], "-IncludeDescendants", StringComparison.Ordinal));

        try
        {
            if (!includeDescendants)
            {
                ProcessEvidence evidence = ReadProcessEvidence(targetProcessId);
                Console.WriteLine(evidence == null ? "{\"Status\":\"not_running\"}" : ProcessJson(evidence));
                return 0;
            }

            List<SnapshotRow> descendants = SelectDescendants(targetProcessId, ReadProcessSnapshot());
            ProcessEvidence root = ReadProcessEvidence(targetProcessId);
            List<ProcessEvidence> processes = new List<ProcessEvidence>();
            if (root != null)
            {
                processes.Add(root);
            }
            foreach (SnapshotRow descendant in descendants)
            {
                ProcessEvidence evidence = ReadProcessEvidence(descendant.ProcessId);
                if (evidence == null)
                {
                    continue;
                }
                if (evidence.ParentProcessId != descendant.ParentProcessId)
                {
                    throw new InvalidOperationException("Native process tree changed during inspection.");
                }
                processes.Add(evidence);
            }
            Console.WriteLine(TreeJson(root, processes));
            return 0;
        }
        catch
        {
            return 1;
        }
    }
}
