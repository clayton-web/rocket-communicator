
# Recipient

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **id** | **kotlin.String** | Canonical Owner-managed Recipient record id (D087). |  |
| **displayName** | **kotlin.String** |  |  |
| **email** | **kotlin.String** | Email from the Owner-managed Recipient record. Not hard-coded and not an environment-variable default Recipient (D087).  |  |
| **active** | **kotlin.Boolean** | Whether the Owner may select this Recipient for **new** handoffs (D087). Inactive Recipients cannot be selected for new handoffs. Deactivation must not rewrite historical Assignment or audit attribution.  |  |
| **relationshipLabel** | **kotlin.String** | Optional relationship label (for example administrator, agent, contractor, lawyer, accountant, tenant, client). Not an application role.  |  [optional] |
| **reminderPreferences** | [**RecipientReminderPreferences**](RecipientReminderPreferences.md) |  |  [optional] |
| **assignmentCategories** | **kotlin.collections.List&lt;kotlin.String&gt;** | Optional Owner-defined categories for delegation routing — not CRM tags/pipelines. |  [optional] |
| **createdAt** | **kotlin.String** |  |  [optional] |
| **updatedAt** | **kotlin.String** |  |  [optional] |



