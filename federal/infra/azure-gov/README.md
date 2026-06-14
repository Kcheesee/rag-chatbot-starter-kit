# Azure Government — ARM deployment (rag-chat-agent, federal tier)

> **STARTING TEMPLATE — NOT a finished, ATO-ready deployment.**
> This is the Azure-equivalent of the AWS GovCloud stack under
> `federal/infra/terraform-govcloud/`. It stands up the wiring quickly so you
> have something concrete to review. It is **your job** to review and harden
> every resource against your agency's ATO requirements (NIST 800-53 / FedRAMP
> High) before it goes anywhere near production data. Read the "Hardening
> checklist" at the bottom before you deploy.

## What this provisions

All resources are tagged `deployment_mode=federal`.

| Resource | Purpose |
|---|---|
| `Microsoft.Network/virtualNetworks` | VNet `10.40.0.0/16` with an **app subnet** (`10.40.0.0/23`, delegated to Container Apps) and a **data subnet** (`10.40.2.0/24`, delegated to PostgreSQL Flexible Server) |
| `Microsoft.Network/privateDnsZones` | Private DNS zone for the PostgreSQL private endpoint, linked to the VNet |
| `Microsoft.OperationalInsights/workspaces` | Log Analytics workspace backing Container Apps logging |
| `Microsoft.App/managedEnvironments` | VNet-integrated, internal-only Container Apps environment |
| `Microsoft.App/containerApps` | The Next.js API container on **port 3000**, **system-assigned managed identity**, env vars + Key Vault secret references |
| `Microsoft.DBforPostgreSQL/flexibleServers` | PostgreSQL Flexible Server (pgvector), **private access** into the data subnet, **TLS required** |
| `Microsoft.Cache/redis` | Azure Cache for Redis for sessions/cache, **TLS-only** (non-SSL port disabled, min TLS 1.2) |
| `Microsoft.KeyVault/vaults` | Key Vault for secrets; the app's managed identity is granted secret **get/list** via the built-in *Key Vault Secrets User* role |
| `Microsoft.CognitiveServices/accounts` *(optional)* | Azure OpenAI account — only when `deployCognitiveServices=true`; otherwise you consume an existing `*.openai.azure.us` endpoint |

### Azure OpenAI

The app consumes Azure OpenAI via the `AZURE_OPENAI_ENDPOINT` env var, which
points at a `*.openai.azure.us` resource. By default this template **does not**
create the OpenAI account — you parameterize the endpoint of one your AI
platform team already manages (`azureOpenAiEndpoint`). Set
`deployCognitiveServices=true` to provision an optional Cognitive Services
(OpenAI kind) account in this template instead. Confirm Azure OpenAI access
approval for your Gov subscription before enabling it.

### pgvector

PostgreSQL is the vector store. The `vector` extension is **allow-listed** by
this template via the `azure.extensions` server parameter (set to `VECTOR`),
but Azure does not auto-create it. After deployment you must connect to the
database and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Prerequisites

- Azure CLI installed (`az version`).
- Access to an **Azure Government** subscription with quota for the SKUs below.
- A resource group in your target Gov region.
- A container image for the Next.js API pushed to an Azure Government container
  registry (`*.azurecr.us`).

## Deploy

### 1. Point the CLI at Azure Government

```bash
az cloud set --name AzureUSGovernment
az login
az account set --subscription "<your-gov-subscription-id>"
```

### 2. Create a resource group

```bash
az group create \
  --name rag-chat-fed-rg \
  --location usgovvirginia
```

### 3. Fill in the parameters file

Copy `azuredeploy.parameters.json` and replace every `REPLACE_ME` /
`REPLACE_WITH_...` placeholder. **Do not commit real secrets.** Prefer passing
the DB admin password (and any Azure OpenAI key) at the command line or from a
secure secret source rather than storing it in the parameters file at all.

### 4. Validate, then deploy

```bash
# Validate / what-if first
az deployment group what-if \
  --resource-group rag-chat-fed-rg \
  --template-file azuredeploy.json \
  --parameters @azuredeploy.parameters.json \
  --parameters dbAdminPassword='<STRONG_PASSWORD>'

# Deploy
az deployment group create \
  --resource-group rag-chat-fed-rg \
  --name rag-chat-fed \
  --template-file azuredeploy.json \
  --parameters @azuredeploy.parameters.json \
  --parameters dbAdminPassword='<STRONG_PASSWORD>'
```

Passing `dbAdminPassword` on the command line overrides the placeholder in the
parameters file, so the real secret never has to be written to disk.

## Required parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `location` | string | `usgovvirginia` | Azure Government region |
| `namePrefix` | string | `ragchat` | 3–12 chars; folded into derived names |
| `environment` | string | `fed` | `fed` / `dev` / `stage` / `prod` |
| `containerImage` | string | `*.azurecr.us/...` | Next.js API image (listens on 3000) |
| `containerRegistryServer` | string | `*.azurecr.us` | Registry login server (grant managed identity AcrPull post-deploy) |
| `dbAdminLogin` | string | `ragchatadmin` | PostgreSQL admin login |
| **`dbAdminPassword`** | **secureString** | *(none)* | **Required.** Provide at deploy time; never commit |
| `azureOpenAiEndpoint` | string | `*.openai.azure.us` | Consumed as `AZURE_OPENAI_ENDPOINT` |
| `azureOpenAiApiKey` | secureString | `""` | Optional; prefer managed-identity RBAC over keys |
| `azureOpenAiApiVersion` | string | `2024-08-01-preview` | |
| `azureOpenAiDeployment` | string | `gpt-4o-prod` | |
| `deployCognitiveServices` | bool | `false` | Provision an OpenAI account in-template |
| `postgresVersion` | string | `16` | `14` / `15` / `16` |
| `postgresSkuName` | string | `Standard_D2ds_v5` | |
| `postgresStorageSizeGB` | int | `128` | |
| `containerCpu` / `containerMemory` | string | `1.0` / `2.0Gi` | Use an approved Container Apps CPU/memory ratio |
| `minReplicas` / `maxReplicas` | int | `1` / `5` | |

## Secrets

- All secrets use `secureString`. **No secrets are hardcoded** in the template.
- The DB admin password (and optional OpenAI key) are written into Key Vault by
  the template and surfaced to the container via **Key Vault references**
  resolved with the app's system-assigned managed identity.
- The Redis connection string is composed from the cache's key at deploy time
  and stored as a Key Vault secret.

## Post-deployment steps

1. **Enable pgvector** — connect to the database and run
   `CREATE EXTENSION IF NOT EXISTS vector;` (the extension is already
   allow-listed at the server level).
2. **Grant AcrPull** to the Container App's managed identity on your
   `*.azurecr.us` registry so it can pull the image.
3. Add **private endpoints** for Redis and Key Vault into the data subnet if
   your boundary requires it (public network access is already disabled on
   both; this template uses VNet rules / service endpoints as a baseline).

## Endpoint reference (Azure Government suffixes)

| Service | Public Azure | Azure Government (used here) |
|---|---|---|
| Key Vault | `*.vault.azure.net` | `*.vault.usgovcloudapi.net` |
| PostgreSQL | `*.postgres.database.azure.com` | `*.postgres.database.usgovcloudapi.net` |
| Redis | `*.redis.cache.windows.net` | `*.redis.cache.usgovcloudapi.net` |
| Azure OpenAI | `*.openai.azure.com` | `*.openai.azure.us` |

## Hardening checklist (do this before the ATO)

This template is deliberately a baseline. Before production / authorization you
should at minimum:

- [ ] Replace static keys with **managed-identity / RBAC** auth everywhere it is
      supported (Azure OpenAI, PostgreSQL Entra auth, Redis Entra auth).
- [ ] Add **private endpoints** for Key Vault, Redis, PostgreSQL, and the
      container registry; remove any remaining service-endpoint shortcuts.
- [ ] Add a **WAF / Application Gateway or Front Door (Gov)** in front of the
      internal Container App if external ingress is required.
- [ ] Turn on **diagnostic settings → Log Analytics / a SIEM** for every
      resource (audit logging is a NIST 800-53 control family).
- [ ] Enable **PostgreSQL high availability** and a tested backup/restore +
      geo-redundancy strategy appropriate to your RTO/RPO.
- [ ] Apply **NSGs** with least-privilege rules on both subnets.
- [ ] Enforce **customer-managed keys (CMK)** for encryption at rest where the
      agency requires it.
- [ ] Review IAM/RBAC scope — the template grants the app *Key Vault Secrets
      User*; confirm no broader roles are needed and none are over-granted.
- [ ] Confirm every SKU and region is **FedRAMP / IL-appropriate** for your
      authorization boundary.

> Treat the output of `az deployment group what-if` and a security review of the
> deployed resources as required steps, not optional ones.
