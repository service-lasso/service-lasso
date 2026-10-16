function Classify-AclGetFailure([System.Management.Automation.ErrorRecord]$original) {
  $operation='owner_read_acl_get'
  try {
    $exception=$original.Exception
    if ($null -ne $exception) {
      if ($exception.GetType() -eq [System.Management.Automation.CommandNotFoundException]) { $operation='owner_read_acl_command_lookup' }
      else { $operation='owner_read_acl_other' }
    }
  } catch { Remember-Original $_ }
  return $operation
}