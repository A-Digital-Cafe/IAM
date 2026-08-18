# IAM [![Security](https://github.com/A-Digital-Cafe/adc-iam/actions/workflows/security.yml/badge.svg)](https://github.com/A-Digital-Cafe/adc-iam/actions/workflows/security.yml)

Preset de identidad, sesión y moderación: quién es cada quien, cómo entra y a quién se le corta el
acceso.

## Contenido

| Módulo | Capa | `kernelMode` | Qué hace |
| ------ | ---- | ------------ | -------- |
| `services/IdentityManagerService` | service | 60 | Usuarios, roles, grupos, organizaciones, regiones y permisos. Multi-tenant: cada organización vive en su propia base. |
| `services/ModerationService` | service | 65 | Lista anti-evasión por hash (email + IP) y sync de baneos con Discord. |
| `services/SessionManagerService` | service | 70 | Login nativo y OAuth (Discord, Google), cookies de sesión, refresh tokens, OIDC y segundo factor. |
| `apps/adc-auth` | app UI | — | Login, registro y recuperación (subdominio `auth`). |
| `apps/adc-identity` | app UI | — | Panel de administración de identidades (subdominio `identity`). Expone `./App` por Module Federation. |

Los tres servicios corren en `kernelMode` (arrancan antes que las apps) y con `failOnError: true`.

## Contrato con el resto de la plataforma

Nada fuera de este preset importa sus clases concretas. Los contratos viven en `@common`:
`IIdentityManagerService`, `ISessionManagerService`, `IModerationService` y los managers en
`@common/types/identity/managers.ts`. El catálogo de roles del sistema (`SystemRole`,
`PREDEFINED_ROLES`, `ROLE_GRANTED_TIERS`) también vive en `@common`
(`@common/types/identity/systemRoles.ts`) porque lo consumen planes, brechas y project-management.

## Dependencias externas

- MongoDB (`object/mongo`) — bases `adc-identity` y `adc-moderation`.
- Redis (`queue/redis`) — sesiones y cache de moderación.
- S3 (`object/internal-s3-provider`) — avatares.
- Opcionales: `EmailService`, `NotificationService`, `AuditLogService`, `SubscriptionService`,
  `DriveService`, `ProjectManagerService`, `content-service`, `ClusterService`.

## Variables de entorno críticas

`JWT_SECRET`, `MONGO_*`, `REDIS_*`, `S3_*`, `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `SESSION_COOKIE_DOMAIN`, `ACCOUNT_DELETION_SECRET`,
`ADC_OIDC_ISSUER`. Cada servicio documenta las suyas en su `.env.example`.

> Sin este preset la plataforma arranca, pero se queda sin autenticación: todo endpoint con permisos
> queda inalcanzable. En la práctica es un preset requerido en cualquier despliegue real.
