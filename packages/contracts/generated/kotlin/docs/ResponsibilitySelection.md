
# ResponsibilitySelection

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **responsibleParty** | [**ResponsiblePartyKind**](ResponsiblePartyKind.md) |  |  |
| **recipientId** | **kotlin.String** | Required when &#x60;responsibleParty&#x60; is &#x60;recipient&#x60;, and must be omitted when it is &#x60;owner&#x60;; a violation is HTTP 400 VALIDATION_ERROR. The Recipient must belong to the Owner&#39;s organization. This is a distinct concept from the rejected legacy top-level &#x60;recipientId&#x60; on approve (D080) and never substitutes for it.  |  [optional] |



