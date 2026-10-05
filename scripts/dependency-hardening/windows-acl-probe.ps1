$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User.Value
$paths = @($env:GITHUB_WORKSPACE, $env:RUNNER_TEMP, $env:TEMP, $env:LOCALAPPDATA, $env:USERPROFILE, [System.IO.Path]::GetTempPath()) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
$snapshot = @()
foreach ($start in $paths) {
    $item = Get-Item -LiteralPath $start -Force
    while ($null -ne $item) {
        $path = $item.FullName
        $acl = Get-Acl -LiteralPath $path
        $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        $sections = [System.Security.AccessControl.AccessControlSections]::Access
        $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm($sections))
        $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
            [pscustomobject]@{
                sid = $_.IdentityReference.Value
                type = $_.AccessControlType.ToString()
                rights = [int64]$_.FileSystemRights
                inherited = [bool]$_.IsInherited
                inheritanceFlags = $_.InheritanceFlags.ToString()
                propagationFlags = $_.PropagationFlags.ToString()
            }
        })
        $driveRoot = [System.IO.Path]::GetPathRoot($path)
        $driveFormat = ([System.IO.DriveInfo]::new($driveRoot)).DriveFormat
        $snapshot += [pscustomobject]@{
            path = $path
            ownerSid = $ownerSid
            currentUserSid = $userSid
            driveFormat = $driveFormat
            daclPresent = ($null -ne $raw.DiscretionaryAcl)
            canonical = [bool]$acl.AreAccessRulesCanonical
            isDirectory = (($item.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0)
            isReparsePoint = (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
            rules = $rules
        }
        $item = $item.Parent
    }
}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Write-Output (ConvertTo-Json -InputObject @($snapshot) -Depth 8 -Compress)
