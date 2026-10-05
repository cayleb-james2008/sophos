$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User.Value
$paths = @($env:GITHUB_WORKSPACE, $env:RUNNER_TEMP) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
$snapshot = @()
foreach ($start in $paths) {
    $item = Get-Item -LiteralPath $start -Force
    while ($null -ne $item) {
        $path = $item.FullName
        $acl = Get-Acl -LiteralPath $path
        $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
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
            rules = $rules
        }
        $item = $item.Parent
    }
}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Write-Output (ConvertTo-Json -InputObject @($snapshot) -Depth 8 -Compress)
