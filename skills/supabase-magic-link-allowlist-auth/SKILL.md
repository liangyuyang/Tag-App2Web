---
name: supabase-magic-link-allowlist-auth
description: "Implement ZenMeasure-style Supabase Magic Link access with internal email domains, customer allowlists, tag/resource assignment, Worker-side email precheck, and RLS-backed authorization."
---

# Supabase Magic Link Allowlist Auth

Use this pattern for ZenMeasure apps where company users and selected customer emails should access operational data without passwords.

## Access Rules

- Supabase Magic Link authenticates the email owner.
- Authorization is separate from authentication.
- Internal domains are trusted operators:
  - `miaomiaoce.com`
  - `zenmeasure.com`
  - `zenmeasure.space`
- External customers must be active in an allowlist table.
- Customer access to resources must be explicit, for example `tag_access(email, tag_id)`.
- Never authorize from user-editable metadata.

## Recommended Tables

- `customer_email_allowlist`: email, role, active, notes.
- `tag_access` or equivalent resource mapping: email, resource id.
- Resource tables such as `tags`.
- Event/data tables such as `tag_readings`.
- Optional user preference table for remembered resources and nicknames.

## RLS Pattern

Enable RLS on every table in the exposed `public` schema.

Use a private helper schema, for example `authz`, for functions:

- `authz.current_email()` reads `auth.jwt() ->> 'email'`.
- `authz.is_internal_user()` checks the email domain.
- `authz.is_admin_user()` checks internal domains or admin allowlist role.
- `authz.can_view_tag(tag_id)` checks admin status or explicit customer resource access.

Keep helper functions out of `public`, revoke public execute, and grant only the needed functions to `authenticated`.

## Magic Link Flow

Frontend:

1. User enters email.
2. Frontend calls Worker `/api/auth/check-email`.
3. Worker allows internal domains or active customer allowlist entries.
4. Frontend calls `supabase.auth.signInWithOtp` with `emailRedirectTo`.

Use `VITE_APP_BASE_URL` for `emailRedirectTo`, and configure Supabase Auth Site URL plus Redirect URLs for production and localhost.

## SMTP

For ZenMeasure apps, follow the GEO-radar SMTP setup:

- Host: `gsgpm1049.siteground.biz`
- Port: `465`
- Admin email: `support@zenmeasure.com`
- Sender name: `ZenMeasure Support`
- Password from local secret `ZENMEASURE_SMTP_PASS`

Do not commit SMTP passwords, Supabase service role keys, MQTT passwords, or customer data.

## Security Checklist

- Magic Link alone is not authorization.
- Do not expose `service_role` in frontend code.
- Use Worker or trusted server code for allowlist precheck and admin writes when needed.
- Explicitly grant Data API access only with RLS enabled.
- If a customer is revoked, set allowlist `active=false`; for immediate cutoff, revoke/delete the Supabase Auth user session.
