<#
.SYNOPSIS
Previews or cancels every active GitHub Actions run in a repository.

.DESCRIPTION
By default this command is read-only. It lists runs in every non-terminal
GitHub Actions state and makes no mutation. Cancellation requires both
-Execute and an exact typed confirmation of the target repository.

.EXAMPLE
.\scripts\cancel-github-actions-runs.ps1

Lists active runs in service-lasso/service-lasso without cancelling them.

.EXAMPLE
.\scripts\cancel-github-actions-runs.ps1 -Execute -Confirmation 'CANCEL service-lasso/service-lasso'

Requests force cancellation for every active run in service-lasso/service-lasso.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^(?:[A-Za-z0-9][A-Za-z0-9_.-]*)/(?:[A-Za-z0-9][A-Za-z0-9_.-]*)$')]
    [string]$Repository = 'service-lasso/service-lasso',

    [switch]$Execute,

    [string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$activeStatuses = @(
    'queued',
    'in_progress',
    'requested',
    'waiting',
    'pending',
    'action_required'
)

function Invoke-GitHubCli {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $displayCommand = 'gh ' + ($Arguments -join ' ')
        throw "GitHub CLI command failed ($LASTEXITCODE): $displayCommand`n$($output -join [Environment]::NewLine)"
    }

    return $output
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI (gh) was not found on PATH. Install it and authenticate before continuing.'
}

Invoke-GitHubCli -Arguments @('auth', 'status') | Out-Null

$runsById = @{}
foreach ($status in $activeStatuses) {
    $endpoint = "/repos/$Repository/actions/runs"
    $pagesJson = Invoke-GitHubCli -Arguments @(
        'api',
        '--method', 'GET',
        '--paginate',
        '--slurp',
        '-H', 'X-GitHub-Api-Version: 2022-11-28',
        '-f', "status=$status",
        '-f', 'per_page=100',
        $endpoint
    )

    $pages = ($pagesJson -join [Environment]::NewLine) | ConvertFrom-Json
    if ($null -eq $pages) {
        continue
    }
    foreach ($page in @($pages)) {
        foreach ($run in @($page.workflow_runs)) {
            $runsById[[string]$run.id] = [PSCustomObject]@{
                Id           = [int64]$run.id
                Status       = [string]$run.status
                Workflow     = [string]$run.name
                Title        = [string]$run.display_title
                Branch       = [string]$run.head_branch
                CreatedAt    = [string]$run.created_at
                Url          = [string]$run.html_url
            }
        }
    }
}

$runs = @($runsById.Values | Sort-Object CreatedAt, Id)
if ($runs.Count -eq 0) {
    Write-Host "No active GitHub Actions runs found for $Repository."
    exit 0
}

Write-Host "Active GitHub Actions runs for ${Repository}:"
$runs |
    Select-Object Id, Status, Workflow, Title, Branch, CreatedAt, Url |
    Format-Table -AutoSize |
    Out-Host

if (-not $Execute) {
    Write-Host ''
    Write-Host 'Dry run only: no workflow run was cancelled.'
    Write-Host "To cancel these $($runs.Count) run(s), re-run with:"
    Write-Host ".\scripts\cancel-github-actions-runs.ps1 -Execute -Confirmation 'CANCEL $Repository'"
    exit 0
}

$expectedConfirmation = "CANCEL $Repository"
if ($Confirmation -cne $expectedConfirmation) {
    throw "Cancellation was not requested. Re-run with -Confirmation '$expectedConfirmation' after reviewing the dry run."
}

foreach ($run in $runs) {
    Write-Host "Requesting force cancellation for run $($run.Id) ($($run.Workflow), $($run.Status))."
    Invoke-GitHubCli -Arguments @('run', 'cancel', [string]$run.Id, '--repo', $Repository, '--force') | Out-Null
}

Write-Host "Requested force cancellation for $($runs.Count) active GitHub Actions run(s) in $Repository."
