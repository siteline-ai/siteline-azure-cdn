// ---------------------------------------------------------------------------
// Siteline Azure CDN Log Processor — Infrastructure
//
// Provisions: Storage Account, Blob Containers (logs + DLQ), Function App
// (Consumption/Linux/Node 20), Event Grid Subscription with dead-letter,
// CDN/Front Door Diagnostic Settings, Managed Identity + RBAC.
//
// Supports: Azure Front Door Standard/Premium and classic Azure CDN profiles.
// ---------------------------------------------------------------------------

@description('Azure region for all resources.')
param location string = resourceGroup().location

// ---- Required ----

@description('Siteline website key for API authentication.')
@secure()
param sitelineWebsiteKey string

@description('Full resource ID of the Azure CDN or Front Door profile to wire diagnostics from.')
param cdnProfileResourceId string

// ---- Optional (sensible defaults) ----

@description('Storage account name (globally unique, 3-24 lowercase alphanumeric).')
param storageAccountName string = 'sitelineazurecdnlogs'

@description('Function app name.')
param functionAppName string = 'siteline-azure-cdn-processor'

@description('Blob container for CDN log files.')
param logContainerName string = 'cdn-logs'

@description('Blob container for Event Grid dead-letter events.')
param dlqContainerName string = 'dlq'

@description('Siteline API intake endpoint.')
param sitelineEndpoint string = 'https://api.siteline.ai/v1/intake/pageview'

@description('Enable Siteline SDK debug logging.')
param sitelineDebug bool = false

@description('Name of the CDN diagnostic setting.')
param cdnDiagnosticSettingsName string = 'siteline-cdn-logs'

@description('Event Grid subscription name.')
param eventSubscriptionName string = 'siteline-blob-log-created'

// ---------------------------------------------------------------------------
// Storage Account
// ---------------------------------------------------------------------------

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource logContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: logContainerName
}

resource dlqContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: dlqContainerName
}

// ---------------------------------------------------------------------------
// Function App (Consumption Plan, Linux, Node 20)
// ---------------------------------------------------------------------------

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${functionAppName}-plan'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'WEBSITE_CONTENTSHARE', value: functionAppName }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'APP_NAME', value: functionAppName }
        { name: 'SITELINE_WEBSITE_KEY', value: sitelineWebsiteKey }
        { name: 'SITELINE_ENDPOINT', value: sitelineEndpoint }
        { name: 'SITELINE_DEBUG', value: string(sitelineDebug) }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// RBAC — Function reads blobs via Managed Identity
// ---------------------------------------------------------------------------

@description('Storage Blob Data Reader built-in role.')
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

resource blobReaderRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionApp.id, storageBlobDataReaderRoleId)
  scope: storageAccount
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataReaderRoleId)
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Event Grid — Blob Created → Function, with dead-letter
// ---------------------------------------------------------------------------

resource eventSubscription 'Microsoft.EventGrid/eventSubscriptions@2024-06-01-preview' = {
  name: eventSubscriptionName
  scope: storageAccount
  properties: {
    destination: {
      endpointType: 'AzureFunction'
      properties: {
        resourceId: '${functionApp.id}/functions/blob-log-processor'
      }
    }
    filter: {
      subjectBeginsWith: '/blobServices/default/containers/${logContainerName}/blobs/'
      includedEventTypes: [
        'Microsoft.Storage.BlobCreated'
      ]
    }
    eventDeliverySchema: 'EventGridSchema'
    deadLetterDestination: {
      endpointType: 'StorageBlob'
      properties: {
        resourceId: storageAccount.id
        blobContainerName: dlqContainerName
      }
    }
    retryPolicy: {
      maxDeliveryAttempts: 30
      eventTimeToLiveInMinutes: 1440
    }
  }
  dependsOn: [
    logContainer
    dlqContainer
  ]
}

// ---------------------------------------------------------------------------
// CDN / Front Door Diagnostic Settings — export logs to Blob Storage
// ---------------------------------------------------------------------------

resource cdnProfile 'Microsoft.Cdn/profiles@2024-02-01' existing = {
  name: split(cdnProfileResourceId, '/')[8]
}

resource cdnDiagnosticSettings 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: cdnDiagnosticSettingsName
  scope: cdnProfile
  properties: {
    storageAccountId: storageAccount.id
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output storageAccountId string = storageAccount.id
output functionAppId string = functionApp.id
output functionAppDefaultHostName string = functionApp.properties.defaultHostName
output functionPrincipalId string = functionApp.identity.principalId
