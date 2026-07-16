
# GmailConnection

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **status** | [**GmailConnectionStatus**](GmailConnectionStatus.md) |  |  |
| **provider** | [**CommunicationProvider**](CommunicationProvider.md) |  |  |
| **historyState** | [**GmailHistoryState**](GmailHistoryState.md) |  |  |
| **pollingIntervalMinutes** | **kotlin.Int** | Configured poll interval (D065 default 5). |  |
| **inboxOnly** | **kotlin.Boolean** | Always true in A5 (D068). |  |
| **readonlyScope** | **kotlin.Boolean** | Always true in A5 — gmail.readonly only (D070). |  |
| **emailAddress** | **kotlin.String** | Connected mailbox address when known. Never a token. |  [optional] |
| **connectedAt** | **kotlin.String** |  |  [optional] |
| **lastSyncAt** | **kotlin.String** |  |  [optional] |
| **lastSuccessAt** | **kotlin.String** |  |  [optional] |
| **lastErrorCode** | **kotlin.String** | Stable machine code only; never raw provider payloads. |  [optional] |



