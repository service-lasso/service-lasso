using System;
using System.IO;
using System.Security.Cryptography;

internal static class WindowsDpapiHelper
{
    private const int MaximumInputCharacters = 350000;

    private static int Main(string[] args)
    {
        byte[] input = null;
        byte[] output = null;
        try
        {
            if (args.Length != 1 || (args[0] != "protect" && args[0] != "unprotect"))
            {
                return 2;
            }

            string encoded = ReadBoundedInput();
            if (!IsCanonicalBase64(encoded))
            {
                return 2;
            }

            input = Convert.FromBase64String(encoded);
            output = args[0] == "protect"
                ? ProtectedData.Protect(input, null, DataProtectionScope.CurrentUser)
                : ProtectedData.Unprotect(input, null, DataProtectionScope.CurrentUser);

            Console.Out.Write(Convert.ToBase64String(output));
            return 0;
        }
        catch (CryptographicException)
        {
            return 3;
        }
        catch (InvalidDataException)
        {
            return 2;
        }
        catch
        {
            return 4;
        }
        finally
        {
            if (input != null)
            {
                Array.Clear(input, 0, input.Length);
            }
            if (output != null)
            {
                Array.Clear(output, 0, output.Length);
            }
        }
    }

    private static string ReadBoundedInput()
    {
        char[] characters = new char[MaximumInputCharacters + 1];
        int length = 0;
        try
        {
            while (length < characters.Length)
            {
                int count = Console.In.Read(characters, length, characters.Length - length);
                if (count == 0)
                {
                    break;
                }
                length += count;
            }

            if (length == 0 || length > MaximumInputCharacters || Console.In.Read() != -1)
            {
                throw new InvalidDataException();
            }
            return new string(characters, 0, length);
        }
        finally
        {
            Array.Clear(characters, 0, characters.Length);
        }
    }

    private static bool IsCanonicalBase64(string value)
    {
        if (value.Length == 0 || value.Length % 4 != 0)
        {
            return false;
        }
        for (int index = 0; index < value.Length; index += 1)
        {
            char character = value[index];
            bool alphabet =
                (character >= 'A' && character <= 'Z') ||
                (character >= 'a' && character <= 'z') ||
                (character >= '0' && character <= '9') ||
                character == '+' ||
                character == '/';
            if (alphabet)
            {
                continue;
            }
            if (character != '=' || index < value.Length - 2)
            {
                return false;
            }
            if (index == value.Length - 2 && value[value.Length - 1] != '=')
            {
                return false;
            }
        }
        try
        {
            byte[] decoded = Convert.FromBase64String(value);
            try
            {
                return String.Equals(Convert.ToBase64String(decoded), value, StringComparison.Ordinal);
            }
            finally
            {
                Array.Clear(decoded, 0, decoded.Length);
            }
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
