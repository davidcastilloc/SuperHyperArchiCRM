# DATA_MODEL.md — Modelo de Datos Canónico Maestro All-in-One (`SuperHyperArchiCRM`)

**Versión:** 2.1.0 (True All-in-One — Auditoría Completa a Nivel de Columna)  
**Fuentes Auditadas Columna por Columna:** **711 tablas/modelos y más de 10,000 columnas** consolidadas desde:
1. `open-mercato` (**346 tablas**, 5,056 columnas en 57 módulos)
2. `Doctors-EHR-New` local + **Supabase Cloud en vivo (`doctors-ehr` Postgres 17)** (**173 tablas únicas**, incluyendo las 22 tablas vivas `therapist_*` / `therapy_*` / `EVV`)
3. `CRMWarehouse-Stores` (**97 tablas** + 38 ENUMs + 8 vistas SQL)
4. `GeorginaPOS` (**18 colecciones** PocketBase + 31 vistas SQL)
5. `open-pos` (**17 tablas** Drizzle SQLite)
6. `hotel-project-turpial` (**15 modelos** Prisma + 16 ENUMs)
7. `apartment-property-management` (**23 contratos** de dominio REST/Zustand)
8. `lawyerplatform` (**12 tablas** Supabase + modelos legales)
9. `helios` (**10 tablas** SQLite / Durable Objects IoT y LPR)

---

## 1. Principio de Unificación: De 711 Tablas Repetidas a 116 Tablas Canónicas

En lugar de copiar 9 esquemas aislados (lo que produciría 9 tablas de usuarios, 8 de facturas, 7 de clientes/pacientes/huéspedes/inquilinos y 6 de inventario inconexas), **SuperHyperArchiCRM** aplica el patrón empresarial **Tronco Compartido + Satélites Tipados**:

- **108 Tablas Relacionales en Cloudflare D1 (`@shac/db-d1`):** Datos maestros, transaccionales históricos, clínicos, legales, hoteleros, inmobiliarios, contables y analíticos. Todas las tablas de negocio llevan el encabezado invariante:
  `id TEXT PK (ULID), tenant_id TEXT NOT NULL, org_id TEXT NOT NULL, custom_fields TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER`
- **8 Tablas Calientes en `BranchInventoryDO` (`@shac/actor-branch`):** Estado en vivo de ultra-baja latencia (`< 1 ms` sin locks externos) para saldos por ubicación/lote FEFO, sesiones de caja POS, bloqueo de habitaciones/unidades/consultorios, cola de sala de espera y pases físicos QR/PIN/LPR.
- **0 Campos Perdidos:** Cada columna especializada de los 9 repositorios vive en su tabla satélite tipada o como campo virtual indexado `v_cf_*` en SQLite.

| Dominio Canónico | Tablas D1 | Tablas DO | Tablas Fuente Absorbidas |
| :--- | :--- | :--- | :--- |
| 1. Kernel, IAM, Seguridad, Dispositivos y Gobernanza | 14 | 0 | `auth`, `directory`, `security`, `sso`, `api_keys`, `audit_logs`, `record_locks`, `perspectives`, `dashboards`, `devices`, `doctor_delegation_pins`, `store_staff` |
| 2. Terceros Unificados (`Parties`), CRM 360 y RRHH/Nómina | 12 | 0 | `customers`, `customer_groups`, `patients`, `patient_guardians`, `guests`, `tenants`, `client_profiles`, `vendors`, `employees`, `staff`, `payroll_runs`, `therapy_payroll_*` |
| 3. Catálogo, Precios 5-Capas, Promociones y Habladores | 10 | 0 | `catalog`, `promotions`, `availability`, `currencies`, `products`, `price_books`, `fee_schedules`, `cpt_codes`, `medication_database` |
| 4. Actor Caliente por Sede (`BranchInventoryDO`) | 0 | 8 | Estado en vivo de stock FEFO, turnos POS, habitaciones/espacios, cola `/lobby`, pases LPR/PIN, idempotencia y outbox |
| 5. POS Todo-Terreno, Ventas Omnicanal y Fiscalidad | 10 | 0 | `sales`, `cart`, `checkout`, `ecommerce`, `open-pos`, `GeorginaPOS`, `store_sales`, `cash_drawer_sessions`, `payment_gateways` |
| 6. WMS Doble Partida, GS1, Costos en Destino y Flota | 11 | 0 | `wms`, `stock_*` (Odoo-style), `purchases`, `inventory_adjustments`, `trucks`, `delivery_drivers`, `delivery_trips` (`e-POD`) |
| 7. Espacios, Hotelería (PMS), Condominios y Agenda | 10 | 0 | `hotel-project-turpial`, `apartment-property-management`, `resources`, `planner`, `appointments`, `appointment_move_logs` |
| 8. Servicio Técnico, Mantenimiento, RMA, Legal y EVV | 7 | 0 | `warranty_claims`, `MaintenanceTicket`, `MaintenanceRequest`, `matters`, `dockets`, `docket_entries`, `therapy_evv_records` |
| 9. Salud, Historia Clínica (EHR), Terapias ABA y RCM | 10 | 0 | `encounters`, `clinical_notes`, `vitals`, `prescriptions`, `eprescriptions`, `lab_*`, `imaging_*`, `therapist_*`, `therapy_*`, `insurance_*`, `edi_*`, `era_*` |
| 10. Contabilidad General GAAP, Tesorería y Trust/IOLTA | 7 | 0 | `accounts`, `chart_of_accounts`, `journal_entries`, `bills`, `expenses`, `bank_reconciliations`, `fixed_assets`, `budgets`, `form_1099s`, `trust_accounting` |
| 11. Documentos, Formularios GDPR, Omnicanalidad e IA | 12 | 0 | `attachments`, `documents` (Yjs), `forms`, `messages`, `communication_channels`, `voice_*`, `inbox_ops`, `business_rules`, `workflows`, `agent_orchestrator`, `webhooks` |
| 12. Control Físico: Cerraduras, Casilleros QR y Garitas LPR | 5 | 0 | `helios` (`gate_states`, `visitor_passes`, `evidence_clips`, `federated_threat_shield`) + `doors`, `packages`, `parking` |
| **TOTAL UNIFICADO ALL-IN-ONE** | **108** | **8** | **100% de las 711 tablas/modelos fuente cubiertas** |

---

## 2. Diccionario Detallado de las 116 Tablas Canónicas (Columnas Clave)

### Dominio 1 — Kernel, IAM, Seguridad, Dispositivos y Gobernanza (`14 tablas D1`)

1. **`iam_tenants`**: `id, slug, name, legal_name, primary_currency, default_locale, encryption_kms_key_ref, status, trial_ends_at, billing_external_refs_json, created_at, updated_at`
2. **`iam_organizations`**: `id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind ('holding'|'branch'|'store'|'warehouse'|'hotel'|'building'|'clinic'|'law_office'|'gatehouse'), tax_id, npi_code, license_number, phone, email, address_json, latitude, longitude, timezone, operating_hours_json, branding_json, receipt_header, receipt_footer, is_primary, is_active`
3. **`iam_users`**: `id, tenant_id, default_org_id, realm ('staff'|'external_portal'), email, email_hash, username, full_name, avatar_url, phone, password_hash_webcrypto, floor_pin_hash (4 dígitos), is_verified, failed_login_attempts, locked_until, sessions_revoked_at, last_login_at, preferences_json, is_active`
4. **`iam_roles`**: `id, tenant_id, slug, name, realm ('staff'|'external_portal'), description, min_active_holders, is_system, is_default`
5. **`iam_acl_grants`**: `id, tenant_id, subject_type ('role'|'user'), subject_id, permissions_json, org_scope_paths_json, allowed_gate_ids_json, is_super_admin`
6. **`iam_auth_factors_and_sso`**: `id, tenant_id, user_id, factor_kind ('totp'|'recovery_code'|'passkey'|'oidc_sso'|'scim_token'|'otp_sms'|'sudo_session'), issuer_or_label, secret_or_hash, idp_subject, scopes_json, expires_at, verified_at, is_active`
7. **`iam_api_keys`**: `id, tenant_id, org_id, name, key_prefix ('mk_live_'), key_sha256, permissions_json, created_by, last_used_at, expires_at`
8. **`iam_delegation_pins`**: `id, tenant_id, org_id, grantor_user_id, redeemer_user_id, pin_sha256 (6 dígitos), scope_permissions_json, duration_label ('4h'|'8h'|'24h'), redeemed_at, expires_at, status` *(Cosechado de `Doctors-EHR-New`)*
9. **`iam_user_devices`**: `id, tenant_id, user_id, device_fingerprint, platform ('ios'|'android'|'web'|'tauri'), push_provider ('apns'|'fcm'|'expo'), push_token, app_version, last_seen_at`
10. **`iam_ui_perspectives`**: `id, tenant_id, org_id, owner_type ('user'|'role'), owner_id, surface_kind ('table_perspective'|'sidebar_variant'|'dashboard_layout'), target_key, locale, config_json, is_default` *(Cosechado de `open-mercato`)*
11. **`kernel_custom_field_defs`**: `id, tenant_id, entity_type, fieldset_code, field_key, label, data_type, is_required, is_encrypted, is_indexed, virtual_column_name ('v_cf_*'), dictionary_id, validation_json`
12. **`kernel_custom_records`** *(+ tabla virtual **`kernel_custom_records_fts`** FTS5)*: `id, tenant_id, org_id, entity_slug, code, title, data_json, search_tokens_hash`
13. **`kernel_record_locks`**: `id, tenant_id, org_id, resource_kind, resource_id, lock_token, strategy ('optimistic'|'pessimistic'), locked_by_user_id, base_version, heartbeat_at, expires_at, conflict_payload_json`
14. **`kernel_audit_logs`**: `id, tenant_id, org_id, log_stream ('action_mutation'|'sensitive_read_phi'|'security_login'), actor_id, delegated_by_id, target_party_id, command_id, resource_kind, resource_id, access_purpose, snapshot_before_json, snapshot_after_json, undo_token, ip_address, user_agent, hmac_signature, created_at`

---

### Dominio 2 — Terceros Unificados (`Parties`), CRM 360 y RRHH/Nómina (`12 tablas D1`)

15. **`crm_parties`**: `id, tenant_id, org_id, party_kind ('person'|'company'), roles_mask_json ('customer'|'vendor'|'patient'|'guest'|'tenant_resident'|'legal_client'|'carrier'), display_name, legal_name, first_name, middle_name, last_name, second_last_name, nationality ('V'|'E'|'OTHER'), tax_id_type ('RIF'|'CEDULA'|'NIT'|'RFC'|'EIN'|'SSN'|'PASSPORT'), tax_id_number, tax_id_hash, primary_email, email_hash, primary_phone, secondary_phone, portal_user_id, owner_user_id, lifecycle_stage, lead_source, temperature, vip_status, loyalty_points, credit_limit_minor, preferred_currency, payment_terms_code, is_1099_vendor, is_active`
16. **`crm_party_profiles`**: `party_id PK, tenant_id, birth_date, gender, marital_status, preferred_language, occupation, employer_name, annual_income_minor, screening_score, mrn_code, guest_preferences_json (piso/almohada/dieta), total_stays, total_spent_minor, has_evictions, agreed_credit_check, kyc_verified_at, kyc_document_urls_json, notes`
17. **`crm_party_links`**: `id, tenant_id, org_id, from_party_id, to_party_id, link_type ('company_contact'|'parent_guardian'|'roommate_occupant'|'emergency_contact'|'co_applicant'|'distributor_store'), role_title, is_primary, can_view_records, can_join_telehealth, share_percentage_bps, commercial_terms_json`
18. **`crm_party_addresses`**: `id, tenant_id, party_id, purpose ('billing'|'shipping'|'home'|'work'|'property'), label, line1, line2, building_no, flat_no, city, state_region, postal_code, country_code, latitude, longitude, is_primary`
19. **`crm_groups_and_terms`**: `id, tenant_id, org_id, parent_id, code, name, group_kind ('b2c'|'b2b'|'vip'|'corporate'|'insurer'), priority, price_list_id, payment_terms_days, default_credit_limit_minor, max_rep_discount_bps, allow_below_cost, auto_invoice_on_delivery, assortment_scope_json`
20. **`crm_group_memberships`**: `id, tenant_id, group_id, party_id, source ('manual'|'rule'|'import'), valid_from, valid_until`
21. **`crm_pipelines_and_stages`**: `id, tenant_id, org_id, pipeline_name, is_default, stages_json (id, label, position, win_probability_bps), stuck_threshold_days`
22. **`crm_deals`**: `id, tenant_id, org_id, pipeline_id, stage_id, party_id, contact_party_id, title, value_minor, currency, probability_bps, expected_close_date, owner_user_id, outcome ('open'|'won'|'lost'), loss_reason, stage_history_json`
23. **`crm_interactions_and_tasks`**: `id, tenant_id, org_id, party_id, deal_id, case_id, kind ('call'|'meeting'|'note'|'task'|'outreach'), title, body, priority, status, due_at, scheduled_start, duration_minutes, recurrence_rule, owner_user_id, assigned_to_user_id, completed_at, is_pinned`
24. **`crm_conflict_checks`**: `id, tenant_id, org_id, candidate_party_id, matter_title, searched_terms_json, matched_parties_json, risk_status ('clear'|'potential_conflict'|'waived'|'blocked'), waiver_document_id, reviewed_by_user_id, reviewed_at` *(Cosechado de `lawyerplatform`)*
25. **`hr_staff_profiles_and_credentials`**: `id, tenant_id, org_id, user_id, employee_number, department_name, job_title, employment_type, specialty, sub_specialty, compensation_type ('salary'|'hourly'|'session_tiered'), base_rate_minor, supervision_rate_minor, indirect_rate_minor, pay_frequency, npi_number, dea_number, bar_or_medical_license, license_state, license_expires_at, cle_or_cme_credits, oig_sanction_status, availability_ruleset_id, signature_svg_url, direct_deposit_json, hire_date, is_active`
26. **`hr_shifts_timesheets_and_payroll`**: `id, tenant_id, org_id, record_type ('shift'|'time_entry'|'leave_request'|'time_report'|'payroll_run'), staff_id, project_or_case_id, party_id, shift_type ('MORNING'|'AFTERNOON'|'EVENING'|'NIGHT'|'SPLIT'), start_at, end_at, clock_in_at, clock_out_at, break_minutes, duration_minutes, rounded_minutes, is_billable, hourly_rate_minor, mileage_miles, mileage_reimbursement_minor, gross_pay_minor, deductions_minor, net_pay_minor, status, approved_by_user_id, line_items_json`

---

### Dominio 3 — Catálogo Universal, Precios de 5 Capas, Promociones y Habladores (`10 tablas D1`)

27. **`cat_categories_and_dictionaries`**: `id, tenant_id, org_id, kind ('product_category'|'tag'|'system_dictionary'), parent_id, tree_path, code, name, color, icon, sort_order, is_active`
28. **`cat_products`**: `id, tenant_id, org_id, item_kind ('physical'|'service'|'clinical_cpt'|'medication'|'room_rate'|'fee'), sku, gtin, mpn, cpt_or_ndc_code, hs_code, name, subtitle, description, category_id, base_uom, sales_uom, tracking_mode ('NONE'|'LOT'|'LOT_EXPIRY'|'SERIAL'), costing_method ('AVCO'|'FIFO'|'STANDARD'), removal_strategy ('FEFO'|'FIFO'), base_price_minor, cost_price_minor, standard_price_minor, primary_currency, tax_class ('GENERAL'|'REDUCED'|'EXEMPT'|'CUSTOM'), tax_rate_bps, is_fixed_price, weight_grams, volume_cm3, dimensions_json, is_perishable, shelf_life_days, temp_min_c, temp_max_c, requires_prescription, dea_schedule, is_controlled, is_public_in_network, media_urls_json, option_schema_json, is_active`
29. **`cat_variants_and_presentations`**: `id, tenant_id, org_id, product_id, sku, barcode, barcode_type ('EAN13'|'UPCA'|'GS1_128'|'QR'|'CODE128'), presentation_name ('UNIDAD'|'PAQUETE'|'CAJA'|'BULTO'|'PALLET'), uom_factor_micros, option_values_json, weight_grams, override_price_minor, default_location_id, is_default, is_active`
30. **`cat_price_lists`**: `id, tenant_id, org_id, code, name, currency, display_mode ('including_tax'|'excluding_tax'), tariff_kind ('retail'|'wholesale'|'contract_1to1'|'medicare'|'medicaid'|'commercial_insurer'|'promotion'), valid_from, valid_to, is_default, is_active`
31. **`cat_price_rules`**: `id, tenant_id, org_id, price_list_id, product_id, variant_id, target_party_id, target_group_id, channel_id, min_qty, max_qty, unit_price_minor, discount_bps, rvu_score_micros, starts_at, ends_at`
32. **`cat_price_history_omnibus`**: `id, tenant_id, org_id, product_id, variant_id, currency, price_minor, lowest_30d_minor, change_source, recorded_at`
33. **`cat_promotions_and_coupons`**: `id, tenant_id, org_id, name, priority, is_cumulative, max_budget_minor, consumed_budget_minor, rules_tree_json, benefits_json, coupon_prefix, coupon_code, max_uses, max_uses_per_party, used_count, starts_at, ends_at, is_active`
34. **`cat_coupon_usages_and_locks`**: `id, tenant_id, promotion_id, code_string, cart_id, order_id, party_id, discount_applied_minor, status ('reserved'|'redeemed'|'released'), expires_at`
35. **`cat_currencies_and_rates`**: `id, tenant_id, org_id, from_currency, to_currency, rate_micros, buy_rate_micros, sell_rate_micros, source ('BCV'|'DOLAR_API'|'CENTRAL_BANK'|'MANUAL'), effective_at, is_active`
36. **`cat_label_print_batches`**: `id, tenant_id, org_id, template_code ('THERMAL_28x18'|'SHELF_DUAL_CURRENCY'|'QR_ASSET'), rate_micros_snapshot, secondary_currency, items_json (sku, qty_copies, price_primary_minor, price_secondary_minor), printed_by_user_id, printed_at` *(Cosechado de `GeorginaPOS` + `CRMWarehouse-Stores`)*

---

### Dominio 4 — Actor Transaccional por Sede (`8 Tablas SQLite dentro de BranchInventoryDO`)

37. **`hot_bin_balances`**: `(product_id, variant_id, bin_code, lot_id) PK, on_hand_qty, reserved_qty, available_qty, unit_cost_minor, updated_at`
38. **`hot_inventory_lots`**: `lot_id PK, product_id, variant_id, lot_code, serial_number, manufacture_epoch_ms, expiry_epoch_ms, quarantine_status, received_at`
39. **`hot_pos_shifts`**: `shift_id PK, register_id, cashier_user_id, cashier_name, status ('OPEN'|'CLOSED'), initial_balances_json, sales_by_currency_json, sales_by_method_json, petty_expenses_json, next_ticket_seq, opened_at, closed_at`
40. **`hot_space_locks`**: `(space_id, slot_bucket) PK, lock_kind ('STAY'|'APPOINTMENT'|'AMENITY'|'MAINTENANCE_BLOCK'), holder_ref_id, party_name_masked, status, check_in_ms, check_out_ms, expires_at_ms`
41. **`hot_queue_board`**: `queue_entry_id PK, party_id, display_initials, priority, station_or_room, provider_id, status ('WAITING'|'CALLED'|'WITH_ASSISTANT'|'IN_SERVICE'|'DONE'), check_in_ms, estimated_wait_min`
42. **`hot_access_passes`**: `pass_hash PK, pass_kind ('DOOR_PIN'|'LOCKER_QR'|'LPR_PLATE'|'VISITOR_PIN'), allowed_device_ids_json, subject_label, valid_from_ms, valid_until_ms, max_uses, uses_count, status`
43. **`hot_idempotency_log`**: `client_mutation_id PK, command_id, request_hash, response_status, response_json, created_at_ms`
44. **`hot_outbox`**: `seq_id INTEGER PK AUTOINCREMENT, event_type, aggregate_id, payload_json, attempts, next_attempt_ms, created_at_ms`

---

### Dominio 5 — POS Todo-Terreno, Ventas Omnicanal y Fiscalidad Regional (`10 tablas D1`)

45. **`pos_registers_and_displays`**: `id, tenant_id, org_id, code, name, device_mode ('POS_REGISTER'|'SMARTCHECK_KIOSK_10S'|'LOBBY_TV'|'GARITA_DECK'), default_warehouse_id, printer_config_json, square_terminal_id, fiscal_printer_serial, is_active`
46. **`pos_cash_closings`**: `id, tenant_id, org_id, shift_id, register_id, cashier_user_id, opened_at, closed_at, shift_duration_sec, initial_balances_json, expected_balances_json, actual_counted_balances_json, discrepancy_balances_json, sales_by_currency_json, sales_by_method_json, expenses_by_currency_json, top_parties_json, total_tickets, audit_status ('pending'|'approved'|'observed'), audited_by_user_id, observations, plain_text_report`
47. **`com_channels_and_stores`**: `id, tenant_id, org_id, code, name, channel_kind ('pos'|'ecommerce'|'b2b_portal'|'pay_link'|'ota'|'marketplace'), domain_hostname, theme_branding_json, default_price_list_id, is_active`
48. **`com_carts_and_paylinks`**: `id, tenant_id, org_id, record_kind ('cart'|'pay_link'|'pay_link_template'), slug_or_token_hash, party_id, currency, tax_mode, lines_json, coupon_codes_json, totals_json, merged_into_id, max_completions, completion_count, password_hash, legal_consents_json, status, expires_at`
49. **`com_quotes`**: `id, tenant_id, org_id, quote_number, party_id, contact_party_id, channel_id, currency, exchange_rate_micros, lines_json, subtotal_minor, discount_minor, tax_minor, total_minor, valid_until, acceptance_token_hash, accepted_at, converted_order_id, status`
50. **`com_orders`**: `id, tenant_id, org_id, order_number, order_kind ('pos_sale'|'b2b_sales_order'|'ecommerce_order'|'replacement_rma'), channel_id, shift_id, register_id, party_id, customer_snapshot_json, warehouse_id, currency, exchange_rate_micros, subtotal_exempt_minor, subtotal_reduced_minor, subtotal_general_minor, discount_minor, tax_general_minor, tax_reduced_minor, withholding_islr_minor, shipping_minor, grand_total_minor, paid_total_minor, change_given_minor, margin_bps, requires_approval, approval_reason, approved_by_user_id, fulfillment_status, payment_status, status, client_mutation_id`
51. **`com_order_lines`**: `id, tenant_id, org_id, order_id, line_no, product_id, variant_id, sku, name, presentation_name, qty_micros, uom, fulfilled_qty_micros, returned_qty_micros, unit_cost_minor, base_price_minor, unit_price_minor, pricing_source_layer, manual_discount_bps, tax_rate_bps, tax_minor, line_total_minor, lot_id, serial_number`
52. **`com_invoices_and_fiscal`**: `id, tenant_id, org_id, invoice_number, order_id, booking_or_lease_id, case_or_encounter_id, party_id, issue_date, due_date, currency, exchange_rate_micros, subtotal_minor, discount_minor, tax_minor, withholding_minor, total_minor, paid_minor, balance_due_minor, region_pack ('ve'|'co'|'mx'|'us'|'global'), fiscal_control_number, dian_cufe_sha384, sat_cfdi_uuid, fiscal_qr_payload, hka_printer_z_report, is_consolidated_24h, consolidation_closes_at, pdf_r2_key, status`
53. **`com_payments`**: `id, tenant_id, org_id, payment_number, order_id, invoice_id, shift_id, party_id, financial_account_id, method_code ('CASH'|'USD_CASH'|'CARD'|'PAGO_MOVIL'|'BIOPAGO'|'ZELLE'|'NEQUI'|'DAVIPLATA'|'PSE'|'BRE_B'|'OXXO_PAY'|'SPEI'|'CODI'|'SQUARE'|'STRIPE'|'ACH'|'HOUSE_ACCOUNT'|'TRUST_RETAINER'), currency, amount_minor, exchange_rate_micros, reference_number, external_gateway_tx_id, idempotency_key, status, paid_at` *(Invariante: `financial_account.currency === payment.currency`)*
54. **`com_returns_and_credit_memos`**: `id, tenant_id, org_id, return_number, original_order_id, invoice_id, party_id, shift_id, return_type ('partial'|'total'), physical_status ('pending'|'inspected_restocked'|'scrapped'|'rejected'), financial_status ('pending'|'credit_memo_issued'|'refunded_cash_bank'), items_json, refund_currency, refund_amount_minor, refund_account_id, authorized_by_user_id, status_history_json`

---

### Dominio 6 — WMS de Doble Partida, GS1, Costos en Destino y Flota GPS (`11 tablas D1`)

55. **`wms_warehouses_and_zones`**: `id, tenant_id, org_id, code, name, zone_code, zone_kind ('dry'|'refrigerated'|'frozen'|'security_cage'|'staging_buffer'|'sales_floor'), temp_min_c, temp_max_c, capacity_volume_cm3, capacity_weight_grams, manager_user_id, is_primary, is_active`
56. **`wms_locations`**: `id, tenant_id, org_id, warehouse_id, parent_id, complete_name, barcode, location_kind ('internal_bin'|'vendor'|'customer'|'transit'|'scrap'|'inventory_loss'|'production'), aisle, rack, shelf_level, max_weight_grams, removal_strategy, is_active`
57. **`wms_packages_and_lots`**: `id, tenant_id, org_id, record_kind ('lot'|'quant_package'), product_id, variant_id, lot_or_package_code, gs1_raw_barcode, serial_number, manufacture_date, best_before_date, expiration_date, removal_alert_date, current_location_id, weight_grams, status`
58. **`wms_pickings`**: `id, tenant_id, org_id, picking_number, operation_kind ('asn_receipt'|'putaway'|'wave_pick'|'pack'|'outgoing_ship'|'internal_transfer'|'pos_drop'), source_location_id, dest_location_id, order_id, purchase_order_id, backorder_of_picking_id, party_id, scheduled_at, completed_at, assigned_to_user_id, status ('draft'|'waiting'|'assigned'|'done'|'cancelled')`
59. **`wms_stock_moves`**: `id, tenant_id, org_id, picking_id, product_id, variant_id, lot_id, package_id, source_location_id, dest_location_id, uom, demanded_qty_micros, done_qty_micros, unit_cost_minor, currency, reason_code, performed_by_user_id, idempotency_key, occurred_at`
60. **`wms_valuation_and_landed_costs`**: `id, tenant_id, org_id, record_kind ('valuation_layer'|'landed_cost_allocation'), product_id, stock_move_id, picking_ids_json, split_method ('by_value'|'by_weight'|'by_volume'|'by_qty'|'equal'), qty_micros, unit_cost_minor, total_value_minor, remaining_qty_micros, remaining_value_minor, cost_components_json`
61. **`wms_reordering_and_putaway_rules`**: `id, tenant_id, org_id, rule_kind ('reorder_minmax'|'putaway_routing'|'b2b_24h_buffer'), warehouse_id, product_id, category_id, target_location_id, min_qty_micros, max_qty_micros, multiple_qty_micros, lead_time_days, preferred_supplier_party_id, preferred_supplier_did, is_active`
62. **`wms_qc_and_cycle_counts`**: `id, tenant_id, org_id, record_kind ('quality_check'|'cycle_count_abc'|'formal_adjustment'), warehouse_id, location_id, picking_id, product_id, lot_id, abc_class, measured_value, norm_min, norm_max, items_variance_json, status ('draft'|'in_review'|'passed'|'failed'|'validated'), evidence_urls_json, inspector_user_id`
63. **`wms_purchase_orders`**: `id, tenant_id, org_id, po_number, supplier_party_id, warehouse_id, currency, items_json, subtotal_minor, tax_minor, total_minor, expected_at, received_at, ordered_by_user_id, status ('draft'|'approved'|'ordered'|'partial'|'received'|'cancelled')`
64. **`wms_stock_requests_and_chat`**: `id, tenant_id, requesting_org_id, fulfilling_org_id, priority, cross_dock_ready, items_json, messages_json (sender_id, body, is_internal_warehouse_only), converted_order_id, status`
65. **`wms_fleet_and_deliveries`**: `id, tenant_id, org_id, record_kind ('vehicle'|'delivery_trip'), vehicle_code, license_plate, max_pallets, max_weight_grams, is_refrigerated, driver_staff_id, order_id, origin_coords_json, dest_coords_json, gps_breadcrumbs_json, departed_at, arrived_at, epod_recipient_name, epod_signature_svg, epod_photo_r2_key, epod_lat, epod_lng, auto_restocked, auto_invoiced, status`

---

### Dominio 7 — Espacios, Hotelería (PMS), Condominios y Agenda (`10 tablas D1`)

66. **`spc_unit_types`**: `id, tenant_id, org_id, code, name, space_category ('hotel_room'|'apartment_unit'|'commercial_local'|'exam_room'|'operating_room'|'service_bay'|'amenity'|'parking_spot'), max_occupancy, bed_or_layout_type, area_sqft, base_rate_minor, rate_period ('hour'|'night'|'month'), amenities_json, media_urls_json, is_active`
67. **`spc_units`**: `id, tenant_id, org_id, unit_type_id, unit_number, floor_label, building_section, current_status ('AVAILABLE'|'OCCUPIED'|'RESERVED'|'CLEANING'|'MAINTENANCE'|'OUT_OF_ORDER'|'BLOCKED'), condition_notes, last_cleaned_at, smart_lock_device_id, monthly_rent_minor, is_active`
68. **`spc_availability_rules`**: `id, tenant_id, org_id, subject_type ('staff'|'space_unit'|'org'), subject_id, timezone, rrule_text, exdates_json, kind ('working_hours'|'holiday'|'blackout')`
69. **`spc_bookings_and_appointments`**: `id, tenant_id, org_id, confirmation_code, booking_kind ('hotel_stay'|'clinical_appointment'|'legal_hearing'|'amenity_slot'|'service_slot'), party_id, provider_staff_id, unit_id, source_channel ('DIRECT'|'WALK_IN'|'PHONE'|'PORTAL'|'BOOKING_COM'|'AIRBNB'|'EXPEDIA'|'CORPORATE'), scheduled_start, scheduled_end, actual_check_in, actual_check_out, adults_count, children_count, recurrence_rule, visit_reason, special_requests, check_in_checklist_json, telehealth_room_id, move_history_json, total_minor, paid_minor, status ('PENDING'|'CONFIRMED'|'CHECKED_IN'|'IN_PROGRESS'|'COMPLETED'|'CHECKED_OUT'|'NO_SHOW'|'CANCELLED')`
70. **`spc_waitlist`**: `id, tenant_id, org_id, party_id, preferred_staff_id, unit_type_id, priority ('LOW'|'MEDIUM'|'HIGH'|'URGENT'), preferred_dates_json, preferred_slots_json, reason, status ('waiting'|'contacted'|'scheduled'|'declined')`
71. **`spc_folios`**: `id, tenant_id, org_id, folio_number, booking_id, party_id, unit_id, currency, charges_json (nights, pos_orders, minibar, extra_fees), subtotal_minor, tax_minor, total_minor, paid_minor, balance_minor, status ('OPEN'|'SETTLED'|'TRANSFERRED_AR')`
72. **`spc_housekeeping_tasks`**: `id, tenant_id, org_id, unit_id, task_kind ('CHECKOUT_CLEANING'|'STAY_OVER'|'DEEP_CLEANING'|'TURNDOWN'|'INSPECTION'|'LINEN_CHANGE'), priority, assigned_to_staff_id, scheduled_for, started_at, completed_at, checklist_json, status`
73. **`lease_applications`**: `id, tenant_id, org_id, applicant_party_id, target_unit_id, application_kind ('NEW_LEASE'|'UNIT_TRANSFER'), desired_move_in, term_months, proposed_rent_minor, screening_score, steps_timeline_json, co_applicant_json, pet_summary_json, signature_svg, status ('SUBMITTED'|'SCREENING'|'APPROVED'|'REJECTED')`
74. **`lease_contracts_and_renewals`**: `id, tenant_id, org_id, record_kind ('active_lease'|'renewal_offer'), lease_number, unit_id, primary_party_id, occupants_json, start_date, end_date, monthly_rent_minor, recurring_breakdown_json (wifi, water, pet_rent, parking, trash), security_deposit_escrow_minor, grace_period_days, late_fee_minor, autopay_enabled, autopay_day_of_month, split_rent_shares_json, renewal_incentives_json, vacate_notice_json (intended_move_out, forwarding_address, move_in_out_inspection_r2_key), electronic_signature_svg, status`
75. **`condo_community_hub`**: `id, tenant_id, org_id, item_kind ('pet_registration'|'lost_pet_alert'|'resident_vehicle'|'community_poll'|'community_event'|'marketplace_listing'|'announcement'), party_id, unit_id, title, body_or_details_json (rabies_tag, is_service_animal, plate, poll_options_votes, rsvp_count, price_minor), priority, starts_at, ends_at, status`

---

### Dominio 8 — Servicio Técnico, Mantenimiento, RMA, Práctica Legal y EVV (`7 tablas D1`)

76. **`srv_work_orders`**: `id, tenant_id, org_id, ticket_number, order_kind ('tech_repair'|'building_maintenance'|'hotel_maintenance'|'internal_support'), party_id, unit_id, common_area_name, category ('PLUMBING'|'HVAC'|'ELECTRICAL'|'APPLIANCE'|'LOCKS'|'IT_HARDWARE'|'NETWORK'|'GENERAL'|'EMERGENCY'), device_serial_or_imei, initial_diagnosis, permission_to_enter, has_pets_alert, preferred_time_window, priority, sla_due_at, assigned_staff_id, eta_at, parts_consumed_json, labor_cost_minor, parts_cost_minor, media_urls_json, comments_thread_json, resident_rating_1to5, started_at, completed_at, status`
77. **`srv_preventive_schedules`**: `id, tenant_id, org_id, fixed_asset_id, unit_id, title, category, frequency_days, checklist_template_json, last_performed_at, next_due_at, assigned_staff_id, is_active`
78. **`srv_warranty_claims_rma`**: `id, tenant_id, org_id, claim_number, party_id, original_order_id, priority, sla_due_at, sla_paused_at, advance_replacement, return_tracking_number, lines_json (product_id, serial_no, lot_no, fault_code, condition_grade, disposition, restocking_fee_minor), replacement_order_id, credit_memo_id, vendor_recovery_status, vendor_recovered_minor, status`
79. **`leg_matters`**: `id, tenant_id, org_id, reference_number, client_party_id, lead_lawyer_staff_id, practice_area, title, description, billing_mode ('hourly'|'flat_fee'|'contingency'|'retainer_trust'), conflict_check_id, opened_at, closed_at, status ('OPEN'|'PENDING'|'CLOSED'|'ARCHIVED')`
80. **`leg_dockets_and_deadlines`**: `id, tenant_id, org_id, matter_id, case_number, case_title, court_name, judge_name, filing_status, auto_sync_enabled, last_synced_at, entries_and_deadlines_json (entry_date, kind 'hearing'|'filing_deadline'|'ruling', summary, fatal_due_at)`
81. **`psa_projects_and_tasks`**: `id, tenant_id, org_id, code, name, party_id, matter_id, budget_kind ('hours'|'amount'), budget_value, hourly_rate_minor, tasks_kanban_json, status`
82. **`evv_field_verifications`**: `id, tenant_id, org_id, source_kind ('home_therapy'|'field_tech'|'property_inspection'|'guard_patrol'), parent_record_id, party_id, staff_id, target_lat, target_lng, clock_in_lat, clock_in_lng, distance_meters, geofence_compliant, clock_in_at, clock_out_at, client_or_caregiver_signature_svg, staff_signature_svg, status` *(Cosechado en vivo de Supabase `therapy_evv_records`)*

---

### Dominio 9 — Salud, Historia Clínica (EHR), Terapias ABA/Grupales y RCM (`10 tablas D1`)

83. **`med_patient_chart_items`**: `id, tenant_id, org_id, patient_party_id, item_kind ('allergy'|'problem_icd10'|'surgical_hx'|'family_hx'|'social_hx'|'immunization'|'care_plan'|'crisis_safety_plan'), code_icd10_or_cvx, title, severity, status, onset_date, resolved_date, lot_number, details_json (reaction, family_relation, warning_signs, coping_strategies, care_goals), recorded_by_staff_id, verified_by_staff_id`
84. **`med_encounters_and_vitals`**: `id, tenant_id, org_id, patient_party_id, provider_staff_id, appointment_id, unit_room_id, encounter_kind ('office_visit'|'telehealth'|'urgent_ed'|'inpatient'|'therapy_session'), chief_complaint, vitals_json (bp_sys, bp_dia, hr, rr, temp, spo2, weight, height, bmi, pain_1to10, fall_risk), ai_scribe_transcript_r2_key, ai_extracted_draft_json, billing_codes_json, started_at, ended_at, signed_by_staff_id, signed_at, status`
85. **`med_clinical_notes`**: `id, tenant_id, org_id, encounter_id, patient_party_id, author_staff_id, note_format ('SOAP'|'STEPPED'|'VISUAL_BODY_MAP'|'DAP_THERAPY'|'PROCEDURE'|'DISCHARGE'), specialty, subjective, objective, assessment, plan, structured_sections_json (ros_14_systems, body_map_pins, mental_status), icd10_codes_json, cpt_codes_json, is_confidential, visible_to_guardian, is_locked, signed_by_staff_id, signed_at, supervisor_cosigned_by_id, cosigned_at, amendment_reason, status`
86. **`med_prescriptions_and_mar`**: `id, tenant_id, org_id, record_kind ('prescription_erx'|'mar_administration'|'refill_request'|'pdmp_check'), patient_party_id, prescriber_staff_id, encounter_id, pharmacy_party_id, medication_name, ndc_code, dosage, sig_instructions, route, quantity, days_supply, refills_authorized, refills_remaining, is_controlled, dea_schedule, epcs_mfa_verified, transmission_id, barcode_scanned, witnessed_by_staff_id, status`
87. **`med_labs_and_imaging`**: `id, tenant_id, org_id, record_kind ('lab_order'|'lab_result'|'imaging_order'|'dicom_study'), order_or_accession_no, patient_party_id, ordering_staff_id, encounter_id, modality_or_category, priority, specimen_type, tests_or_body_part_json, result_value, reference_range, abnormal_flag ('NORMAL'|'ABNORMAL'|'CRITICAL'), dicom_or_report_r2_key, hl7_fhir_payload_json, reviewed_by_staff_id, reviewed_at, status`
88. **`med_referrals_prior_auth_and_hie`**: `id, tenant_id, org_id, record_kind ('referral'|'prior_authorization'|'ccm_rpm_enrollment'|'hie_exchange'), patient_party_id, referring_staff_id, external_provider_name, external_npi, payer_name, auth_number, cpt_codes_json, units_authorized, units_used, valid_from, valid_to, consent_signed, payload_json, status`
89. **`med_therapy_groups_and_aba`**: `id, tenant_id, org_id, record_kind ('therapy_group'|'group_session_attendance'|'aba_data_session'|'aba_trial'|'aba_abc_behavior'|'digital_homework'|'assessment_scale'), group_or_session_id, patient_party_id, therapist_staff_id, title_or_behavior, antecedent, consequence, prompt_level, is_correct_trial, score, severity_level, duration_sec, payload_json, occurred_at` *(Cosechado en vivo de Supabase `therapist_*` / `therapy_*`)*
90. **`med_supervision_queue`**: `id, tenant_id, org_id, associate_staff_id, supervisor_staff_id, patient_party_id, clinical_note_id, flagged, flag_reason, feedback, status ('pending'|'approved'|'changes_requested'), submitted_at, reviewed_at`
91. **`med_patient_insurances`**: `id, tenant_id, org_id, patient_party_id, payer_party_id, priority_rank (1|2|3), policy_number, group_number, member_id, subscriber_name, subscriber_dob, relationship, copay_minor, deductible_minor, deductible_met_minor, card_front_r2_key, card_back_r2_key, ocr_confidence_bps, last_eligibility_271_json, verified_at, is_active`
92. **`med_rcm_claims_and_era`**: `id, tenant_id, org_id, record_kind ('superbill'|'claim_837'|'era_remittance_835'|'payment_plan'), claim_or_check_number, patient_party_id, encounter_id, insurance_id, diagnosis_codes_json, claim_lines_json (cpt, modifiers_1_4, units, charge_minor, allowed_minor, paid_minor, adjustment_minor), total_charge_minor, allowed_minor, insurer_paid_minor, patient_responsibility_minor, scrubber_warnings_json, denial_code, appeal_deadline, raw_edi_r2_key, installments_json, status`

---

### Dominio 10 — Contabilidad General GAAP, Tesorería Multi-Divisa y Trust/IOLTA (`7 tablas D1`)

93. **`fin_accounts`**: `id, tenant_id, org_id, code, name, account_kind ('cash_drawer'|'petty_cash'|'bank_checking'|'bank_savings'|'digital_wallet'|'credit_card'|'clearing'), currency, bank_name, account_number_masked, gl_account_id, opening_balance_minor, current_balance_minor, is_default, is_active`
94. **`fin_trust_escrow_ledgers`**: `id, tenant_id, org_id, ledger_kind ('legal_iolta_trust'|'lease_security_deposit'|'customer_retainer'), party_id, matter_or_lease_id, bank_account_id, currency, balance_minor (CHECK >= 0), transactions_json (deposit, disbursement_to_invoice, refund, ref_no), status`
95. **`fin_chart_of_accounts_and_periods`**: `id, tenant_id, org_id, record_kind ('gl_account'|'fiscal_period'), account_code, name, classification ('asset'|'liability'|'equity'|'revenue'|'cogs'|'expense'), normal_balance ('debit'|'credit'), parent_id, currency, current_balance_minor, fiscal_year, period_number, start_date, end_date, is_closed`
96. **`fin_journal_entries`**: `id, tenant_id, org_id, entry_number, entry_date, fiscal_year, fiscal_period, source_module, source_record_id, reference, description, lines_json (gl_account_id, debit_minor, credit_minor, memo), total_debit_minor, total_credit_minor, status ('draft'|'posted'|'void'), posted_by_user_id`
97. **`fin_ap_bills_and_expenses`**: `id, tenant_id, org_id, record_kind ('vendor_bill'|'operational_expense'|'recurring_template'|'form_1099'), bill_or_expense_no, vendor_party_id, category, currency, subtotal_minor, tax_minor, total_minor, paid_minor, balance_due_minor, issue_date, due_date, recurrence_freq, next_run_date, is_reimbursable, receipt_r2_key, lines_json, approved_by_user_id, status`
98. **`fin_bank_reconciliations`**: `id, tenant_id, org_id, financial_account_id, statement_date, statement_balance_minor, book_balance_minor, difference_minor, matched_tx_ids_json, reconciled_by_user_id, completed_at, status`
99. **`fin_fixed_assets_and_budgets`**: `id, tenant_id, org_id, record_kind ('fixed_asset'|'annual_budget'), code_or_tag, name, category, serial_number, acquisition_date, acquisition_cost_minor, salvage_value_minor, useful_life_months, depreciation_method ('straight_line'|'macrs'), accumulated_depreciation_minor, fiscal_year, monthly_budget_minor_json, actual_spent_minor, status`

---

### Dominio 11 — Documentos, Formularios GDPR, Omnicanalidad, Automatización e IA (`12 tablas D1`)

100. **`doc_attachments`**: `id, tenant_id, org_id, partition_code ('public_media'|'private_docs'|'clinical_phi'|'legal_vault'), entity_type, record_id, party_id, file_name, mime_type, file_size_bytes, r2_object_key, sha256_hash, ocr_extracted_text, is_confidential, uploaded_by_user_id`
101. **`doc_collaborative_pages`**: `id, tenant_id, org_id, folder_id, title, template_id, yjs_state_r2_key, content_html, version_no, linked_entities_json, shares_acl_json, is_active`
102. **`doc_forms_and_submissions`**: `id, tenant_id, org_id, record_kind ('form_def'|'form_submission'|'signed_consent'), form_slug, version_no, schema_json, party_id, case_or_encounter_id, answers_encrypted_json, clause_sha256, signature_svg, signed_by_ip, gdpr_retention_until, anonymized_at, status`
103. **`comm_channels`**: `id, tenant_id, org_id, owner_user_id, provider_key ('resend'|'ses'|'gmail_oauth'|'imap'|'whatsapp'|'telegram'|'discord'|'twilio_sms'), visibility ('personal_owner_only'|'shared_org'), credentials_encrypted, status`
104. **`comm_threads_and_messages`**: `id, tenant_id, org_id, channel_id, thread_kind ('internal_team'|'portal_support'|'crm_email'|'whatsapp_chat'|'telehealth_chat'), subject, party_id, linked_object_ref_json, shared_with_user_ids_json, sender_id, sender_type, body, attachments_json, read_by_json, is_confidential, sent_at`
105. **`comm_voice_ai_and_calls`**: `id, tenant_id, org_id, record_kind ('voice_agent'|'phone_call_log'|'outbound_campaign'), agent_name, phone_number, voice_model, system_prompt, transfer_number, party_id, direction ('inbound'|'outbound'), duration_sec, recording_r2_key, transcript, ai_extracted_intent_json, campaign_leads_json, status`
106. **`comm_notifications`**: `id, tenant_id, org_id, recipient_user_id, notification_type, severity, title, body, action_url, channels_json ('in_app'|'email'|'push'|'sms'), read_at, actioned_at`
107. **`auto_business_rules`**: `id, tenant_id, org_id, rule_code, name, rule_kind ('GUARD'|'VALIDATION'|'CALCULATION'|'ASSIGNMENT'|'ACTION'), entity_type, lifecycle_event, priority, condition_ast_json, actions_json, is_enabled`
108. **`auto_workflows`**: `id, tenant_id, org_id, workflow_code, version_no, definition_graph_json, event_triggers_json, is_enabled`
109. **`auto_workflow_instances_and_tasks`**: `id, tenant_id, org_id, workflow_id, correlation_key, current_step_id, context_json, user_tasks_json (assignee, due_at, form_data, status), status ('running'|'waiting_human'|'waiting_signal'|'completed'|'failed')`
110. **`ai_conversations_and_proposals`**: `id, tenant_id, org_id, record_kind ('copilot_chat'|'inbox_ops_email'|'mutation_proposal_card'|'token_usage_daily'), owner_user_id, agent_id, model_id, messages_or_email_json, target_command_id, target_record_id, proposed_diff_json, confidence_bps, disposition ('pending'|'approved'|'rejected'|'auto_applied'), resolved_by_user_id, input_tokens, output_tokens, cost_minor`
111. **`int_webhooks_and_sync_jobs`**: `id, tenant_id, org_id, record_kind ('webhook_endpoint'|'webhook_delivery'|'external_sync_cursor'|'csv_migration_job'), provider_or_url, hmac_secret_enc, subscribed_events_json, cursor_state, field_mapping_json, processed_count, failed_count, last_error, status`

---

### Dominio 12 — Control Físico: Cerraduras IoT, Casilleros QR y Garitas LPR (`5 tablas D1`)

112. **`phy_devices_and_gates`**: `id, tenant_id, org_id, unit_id, name, device_kind ('SMART_DOOR_LOCK'|'SLIDING_GATE'|'LPR_BARRIER'|'MAGNETIC_DOOR'|'WAREHOUSE_SHUTTER'|'SMART_LOCKER'|'CCTV_CAMERA'), vendor_driver ('hikvision'|'uniview'|'dahua'|'zkteco'|'onvif'|'shelly'|'esphome'|'modbus_tcp'|'mqtt'|'smartlock_cloud'), linked_camera_id, battery_pct, lock_or_relay_state, auto_lock_sec, dual_path_mode, last_heartbeat_at, watchdog_status, is_active`
113. **`phy_access_passes`**: `id, tenant_id, org_id, unit_id, party_id, booking_or_lease_id, pass_kind ('RESIDENT_PERMANENT'|'VIP_LPR'|'FLEET_CARGO_LPR'|'VISITOR_TEMP'|'DELIVERY_PIN'|'SERVICE_TECH'), holder_name, license_plate, pin_or_qr_hash, allowed_device_ids_json, valid_from, valid_until, whatsapp_share_text, status`
114. **`phy_package_deliveries`**: `id, tenant_id, org_id, unit_id, recipient_party_id, locker_device_id, carrier_name ('Amazon'|'FedEx'|'UPS'|'USPS'|'Local'), tracking_number, package_size, pickup_pin_or_qr_hash, arrived_at, picked_up_at, status ('in_transit'|'ready_for_pickup'|'picked_up')`
115. **`phy_access_audit_logs`**: `id, tenant_id, org_id, device_id, pass_id, actor_or_plate, maneuver ('OPEN_PULSE'|'HOLD_OPEN'|'CLOSE'|'LOCKDOWN'|'WHATSAPP_APPROVED'|'DENIED_UNKNOWN_PLATE'), snapshot_r2_key, hmac_signature, occurred_at`
116. **`phy_evidence_and_threat_shield`**: `id, tenant_id, org_id, record_kind ('forensic_clip'|'hostile_plate_alert'), camera_device_id, license_plate, reason_or_incident, severity, duration_sec, clip_r2_key, legal_sha256_hash, origin_site_did, created_at`

---

## 3. Verificación de Peso y Rendimiento del Esquema All-in-One en Cloudflare

- **Espacio en Disco D1 por Inquilino:** Las 108 tablas vacías con sus índices compuestos `(tenant_id, ...)` ocupan `~620 KB` en SQLite (`0.12%` del límite gratuito de `500 MB` y `0.006%` de los `10 GB` incluidos en Workers Paid).
- **Peso en el Binario del Worker (`gzip`):** Declaradas como constructores modulares Drizzle SQLite sin decoradores ni reflexión, las 116 tablas + sus validadores Zod pesan `~145 KiB gzip`, dejando más de `750 KiB gzip` libres para los comandos de negocio dentro de nuestra meta autoimpuesta de `< 1 MiB gzip` (frente a los límites reales de `3 MiB` Free y `10 MiB` Paid).
- **Activación Tipo "App Store Interno" en `CONFIG_KV`:** Las tablas existen listas desde el aprovisionamiento inicial; cuando el dueño de un negocio activa un nuevo módulo en Configuración (por ejemplo, un hotel activa *POS Restaurante*, *Eventos* y *Barrera LPR de Estacionamiento*, o una clínica activa *Farmacia FEFO* y *Visitas Domiciliarias EVV*), se enciende en **`0 milisegundos`** sin migraciones bloqueantes ni tiempo fuera de línea.
