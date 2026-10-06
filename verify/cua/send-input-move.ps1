[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('get', 'position', 'move', 'restore')]
    [string]$Mode,
    [int]$X = 0,
    [int]$Y = 0
)

$ErrorActionPreference = 'Stop'

$nativeSource = @'
using System;
using System.Runtime.InteropServices;

public static class NativeCompositionWheelProbe
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)]
        public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION U;
    }

    private const uint INPUT_MOUSE = 0;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int inputSize);

    public static int[] GetPosition()
    {
        POINT point;
        if (!GetCursorPos(out point))
        {
            throw new InvalidOperationException("GetCursorPos failed: " + Marshal.GetLastWin32Error());
        }
        return new int[] { point.X, point.Y };
    }

    public static int InputSize()
    {
        return Marshal.SizeOf(typeof(INPUT));
    }

    public static bool PositionCursor(int x, int y)
    {
        return SetCursorPos(x, y);
    }

    public static bool RestorePosition(int x, int y)
    {
        return SetCursorPos(x, y);
    }

    public static uint MoveWithSynthesizedInput(int screenX, int screenY)
    {
        int virtualX = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int virtualY = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int virtualWidth = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
        int virtualHeight = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
        long denominatorX = Math.Max(1, virtualWidth - 1);
        long denominatorY = Math.Max(1, virtualHeight - 1);
        int normalizedX = (int)Math.Max(0L, Math.Min(65535L,
            ((long)screenX - virtualX) * 65535L / denominatorX));
        int normalizedY = (int)Math.Max(0L, Math.Min(65535L,
            ((long)screenY - virtualY) * 65535L / denominatorY));

        INPUT input = new INPUT
        {
            type = INPUT_MOUSE,
            U = new INPUTUNION
            {
                mi = new MOUSEINPUT
                {
                    dx = normalizedX,
                    dy = normalizedY,
                    mouseData = 0,
                    dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    time = 0,
                    dwExtraInfo = UIntPtr.Zero
                }
            }
        };
        return SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@

try {
    Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
    switch ($Mode) {
        'get' {
            $position = [NativeCompositionWheelProbe]::GetPosition()
            [pscustomobject]@{
                mode = 'get'
                x = [int]$position[0]
                y = [int]$position[1]
            } | ConvertTo-Json -Compress
        }
        'position' {
            $positioned = [NativeCompositionWheelProbe]::PositionCursor($X, $Y)
            if (-not $positioned) {
                throw "SetCursorPos before wheel failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
            }
            $readback = [NativeCompositionWheelProbe]::GetPosition()
            [pscustomobject]@{
                mode = 'position'
                screenX = $X
                screenY = $Y
                positioned = $true
                actualScreenX = [int]$readback[0]
                actualScreenY = [int]$readback[1]
                path = 'SetCursorPos (shared by every A/B arm)'
            } | ConvertTo-Json -Compress
        }
        'move' {
            $sent = [NativeCompositionWheelProbe]::MoveWithSynthesizedInput($X, $Y)
            $readback = [NativeCompositionWheelProbe]::GetPosition()
            [pscustomobject]@{
                mode = 'move'
                screenX = $X
                screenY = $Y
                actualScreenX = [int]$readback[0]
                actualScreenY = [int]$readback[1]
                sendInputCount = [int]$sent
                eventFlags = 'MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE|MOUSEEVENTF_VIRTUALDESK'
                inputSize = [NativeCompositionWheelProbe]::InputSize()
            } | ConvertTo-Json -Compress
        }
        'restore' {
            $restored = [NativeCompositionWheelProbe]::RestorePosition($X, $Y)
            if (-not $restored) {
                throw "SetCursorPos restore failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
            }
            $readback = [NativeCompositionWheelProbe]::GetPosition()
            [pscustomobject]@{
                mode = 'restore'
                x = $X
                y = $Y
                actualX = [int]$readback[0]
                actualY = [int]$readback[1]
                restored = $true
            } | ConvertTo-Json -Compress
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 1
}
