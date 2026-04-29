# Tenancy Portal Field-Mapping Report — 2026-04-28

> Permanent record of the supervised, read-only field-mapping run
> against the LHDN e-Duti Setem **Sewa/Pajakan / Perjanjian Sewa**
> portal (formv2 / p5). This document is the source of truth for which
> portal fields WeStamp's tenancy model already covers, which fields
> are missing, and which workflows are not currently safe to automate.
>
> No live portal mutation occurred. No code was committed during the
> run. Temporary harness, control, and log files were deleted at the
> end of the run.

## 1. Run Metadata

| Field | Value |
|---|---|
| Run ID | **ε-3** |
| Date | 2026-04-28 |
| Method | Playwright `chromium.connectOverCDP()` attached to the user's regular Chrome (port 9222) with a dedicated `--user-data-dir` |
| Target job ID | `d03195f6-17e0-4f95-83b1-5830bf2f1085` |
| Source instrument | `5_Tenancy_Agreement.pdf` |
| Portal path | `formv2/p5/edit` (Sewa/Pajakan / Perjanjian Sewa) |
| LHDN application ID | (redacted from this artifact) |
| Snaps performed | **13** read-only DOM inspections |
| Mutating actions | **0** — no clicks on Simpan / Simpan Bahagian / Hantar / Tambah; no typing into portal fields; no upload; no payment; no certificate retrieval |
| Code committed during the run | **None** |
| Temporary files | `_field-mapping-cdp-tmp.ts`, `_field-mapping-cdp-control.txt`, `_field-mapping-cdp-output.log` — all deleted post-run |

## 2. Coverage Map (13 Snaps)

| # | Label | Visible/Total | Notes |
|---|---|---|---|
| 1 | `maklumat_am` | n/a | section anchor confirmed |
| 2 | `bahagian_a` (empty) | n/a | three Tambah buttons confirmed (Individu / SSM / Bukan SSM) |
| 3 | `bahagian_a_individu_added` | n/a | individual party modal & row commit confirmed |
| 4 | `bahagian_a_ssm_added` | n/a | SSM modal exposes full representative-identity capture |
| 5 | `bahagian_a_non_ssm_added` | n/a | Non-SSM modal exposes minimal representative capture |
| 6 | `bahagian_b` | n/a | base field set confirmed |
| 7 | `bahagian_b_after_pds_jenis_1103` | 15/69 | fixed-rent — no per-period reveal |
| 8 | `bahagian_b_after_pds_jenis_1105` | 15/69 | amendment — `par_id` did NOT reveal |
| 9 | `bahagian_b_after_pds_jenis_1104` | 15/69 | variable-rent — no per-period reveal |
| 10 | `bahagian_c` | n/a | all 7 Bahagian C land-registry fields confirmed |
| 11 | `rumusan` | 3/69 | all duty-calc readonly+hidden until computed |
| 12 | `lampiran` | 3/69 | upload widget loads conditionally (not in static DOM) |
| 13 | `perakuan` | 6/69 | `pds_refno` / `mesej_user` / `pds_akuan` / `pre_hantar` exposed |

## 3. Confirmed Mappings (Model Validates)

| WeStamp model element | Portal evidence | Status |
|---|---|---|
| `pds_suratcara = 1101` (Perjanjian Sewa) | 7-option dropdown; only 1101 is in the modelled scope | ✓ correct |
| Three party types: `individual` / `company_ssm` / `company_non_ssm` | Three Tambah buttons trigger three distinct modals | ✓ correct |
| `TenancyPortalDescriptionType` enum (6 values) | `pds_jenis` exposes exactly 6 real options + placeholder | ✓ enum complete |
| `TenancyPortalPropertyType` enum (4 values) | `pds_harta_type` exposes 4 options that match 1:1 | ✓ correct |
| Email is optional | Portal does not require an email field | ✓ correct |
| TIN auto-population | Portal exposes `tb_cukai_display` (readonly) + `tb_cukai` (hidden) — matches WeStamp's `tinAutoGenerationExpected` posture | ✓ correct |
| All 16 known `pds_*` field keys WeStamp models | Confirmed present in Bahagian B/C DOM | ✓ correct |

## 4. Critical Model Gaps Discovered

### 4.1 Architectural — Multi-Pass Compiler Required (P0)

The portal has **no client-side conditional rendering on `pds_jenis`**.
Snaps for `pds_jenis ∈ {1103, 1104, 1105}` produced an identical
15-visible-fields-out-of-69 set. All conditional reveal happens
**server-side after Simpan**.

**Implication:** The committed `tenancy-browser-instructions.ts` is a
single-pass instruction list; the portal requires a **phased
instruction graph** with explicit save-and-reinspect checkpoints
between sections:

1. Maklumat Am → Simpan
2. Bahagian A (per-party modal flows × N parties)
3. Bahagian B base → Simpan → re-inspect for `par_id` (1105) or per-period rent (1104)
4. Bahagian C → Simpan
5. Lampiran (upload widget visible only after Bahagian B/C save)
6. Rumusan (duty-calc fields visible only after server compute)
7. Perakuan: tick `pds_akuan` → click `pre_hantar` → confirm modal → `pdsL01_button_hantar`

### 4.2 Two-Stage Submission (`pre_hantar` → `hantar`) (P0)

The Perakuan section exposes **two** submission buttons:
- `#pre_hantar` — visible, opens a confirmation modal
- `#pdsL01_button_hantar` — hidden until pre-confirmation

`tenancy-browser-instructions.ts` currently models a single Hantar
tick. The instruction draft must be extended to model both stages,
with the operator's final-approval gate placed between them.

### 4.3 Bahagian C Land-Registry Fields Missing from WeStamp (P0)

| Portal field | Portal label | Required? | WeStamp coverage |
|---|---|---|---|
| `pds_mp` | Milik Penuh | required | **missing** |
| `pds_lot` | No. Lot | required | **missing** |
| `pds_mukim` | Mukim | required | **missing** |
| `pds_daerah` | Daerah | required | **missing** |
| `pds_kegunaan` | Kegunaan | optional | **missing** |
| `pds_luas` | Luas Tanah | required | **missing** (note: distinct from WeStamp's `premisesAreaSqm` which represents built-up area) |
| `pds_luasunit` | Unit Luas (5 options: Ekar / Hektar / Kps / Mps) | optional | **missing** |

### 4.4 Maklumat-Am-Level Fields Missing (P0)

| Portal field | Notes | WeStamp coverage |
|---|---|---|
| `pds_dutisetem` | 17-option dropdown — duty type | **missing** |
| `pds_ps` | Prinsipal vs Surat Cara berkaitan Pajakan 49(e) | **missing** |
| `pds_balasan` | Single text input — consideration amount | partially modelled via `rentSchedule` aggregation; needs explicit field |
| `pds_remit` | 16-option dropdown — remission category | **missing** |
| `pds_perjanjian` checkboxes (`kmkt`, `klnm`, `vienna`) | Diplomatic exemptions | **missing** |
| `pds_radio_ya` / `pds_radio_tidak` | Purpose unconfirmed (likely "previously stamped?") | **missing** |

### 4.5 Per-Party Identity Capture Gaps (P0/P1)

**Citizenship — 2-way → 3-way:**
- Portal `warga`: `1=Citizen`, `2=Non-citizen`, `3=PR`
- WeStamp: 2-way (`malaysian` / `non_malaysian`) — **PR unmodelled**

**NRIC sub-types — 1-way → 4-way:**
- Portal `EPD_NOKP_TYPE`: `IC_BARU` / `IC_LAMA` / `IC_POLIS` / `IC_ARMY`
- WeStamp: single NRIC field — **3 sub-types unmodelled**

**Gender (`USER_SEX`) — required by portal — completely unmodelled.**

**SSM company representative-person identity** — full identity capture
(`owner_name`, `warga`, IC type, IC/passport, gender) is required for
SSM-registered companies. WeStamp captures **none** of these for SSM
parties. Non-SSM company parties have no rep-identity requirement.

**SSM-specific company fields:**
- `jenis_perniagaan` (6 options — business type) — missing
- `tb_roc` AND `tb_roc_new` split — currently single `roc` field
- `tb_syarikat` (local/foreign) — missing

### 4.6 Address Field Gaps (P2)

- `tb_alamat_2` is **required** by the portal for parties; WeStamp models it as optional
- `tb_alamat_3` is unmodelled
- `pds_alamat_2` / `pds_alamat_3` (property address lines 2/3) are unmodelled

### 4.7 Geographic Canonicalization (P2)

| Portal field | Options | WeStamp |
|---|---|---|
| `pds_harta_state` | 17 fixed | free string — **canonicalization needed** |
| `pds_harta_country` | 279 fixed | free string — **canonicalization needed** |

Operator-side mapping table required to translate WeStamp's free-string
state / country values to the portal's enum codes.

### 4.8 Misc Field Type Mismatches (P2/P3)

- `pds_salinan` (number-of-copies) is a **21-option dropdown** (likely 1–20 + ">20"), not a free-form integer as WeStamp models.
- `pds_refno` (operator reference number, optional) — unmodelled.
- `mesej_user` (user-message textarea, optional) — unmodelled.
- `DSD_APPLY_DATE` purpose unconfirmed (no visible label observed during the run).
- `pds_harta_cat` is **per-property-type** in the portal:
  - Kediaman → 8 options (kembar / teres / kondominium / pangsapuri / sesebuah / rumah_pangsa / kluster / townhouse)
  - Perdagangan → 4 options (rumah_kedai / ruang_perniagaan / ruang_pejabat / kedai_pejabat)
  - Perindustrian → 5 options (sesebuah / kembar / teres / bertingkat / banglo)
  - WeStamp's `TenancyPortalBuildingType` enum mixes only kediaman-style values; perdagangan and perindustrian have **no model coverage**.
  - WeStamp values `studio` and `lain_lain` have **no direct portal equivalent** in any of the per-property-type dropdowns.
  - WeStamp `apartment` is ambiguous; the closest portal kediaman option is `pangsapuri`.
- `furnishedStatus`: portal exposes only `dengan_perabot` / `tanpa_perabot`. WeStamp's `partially_furnished` value has **no portal equivalent**.

## 5. Operationally-Confirmed Behaviours

- **Tab switches discard modal data.** The operator must commit a party row before switching sections.
- **Modal-internal Simpan is local-only.** It commits the row to a local table that the parent form persists on its own Simpan; it does NOT round-trip to the server on its own.
- **Lampiran upload widget is not in the static DOM.** It loads after Bahagian B/C Simpan succeeds.
- **Rumusan duty-calc fields** (`d_sc`, `d_ab`, `dt_kena`, etc.) are all `readonly+hidden` until the server has computed duty.
- **`par_id` reveal trigger is server-side, not `pds_jenis`-change-handler-side.** Confirmed by the 1105 snap showing `par_id` still hidden after dropdown selection.

## 6. Recommended Next Milestone Sequence

### Milestone A — Minimum Viable Correctness (P0)

1. Extend `tenancy-portal-payload.ts` to capture: `pds_dutisetem`, `pds_ps`, `pds_balasan`, `pds_remit`, all `pds_perjanjian` flags, all 7 Bahagian C land-registry fields (`pds_mp`, `pds_lot`, `pds_mukim`, `pds_daerah`, `pds_kegunaan`, `pds_luas`, `pds_luasunit`).
2. Add citizenship 3-way enum (`citizen | non_citizen | pr`) and gender capture.
3. Add NRIC sub-type 4-way enum.
4. Add SSM company representative-identity capture (`owner_name` + identity fields).
5. Hard-block `pds_jenis = 1105` (amendment) in the run-readiness gate until a multi-pass compiler exists.
6. Hard-block `rentSchedule.length > 1` in the run-readiness gate until a multi-pass compiler exists.
7. Add explicit `pds_salinan` value validation (must be a portal-recognized 1-of-21 code).

### Milestone B — Multi-Pass Instruction Compiler (P0)

8. Redesign `tenancy-browser-instructions.ts` as a phased instruction graph with save-checkpoint nodes. The graph should be expressible as a deterministic DAG so the operator UI can render phase progress.
9. Add the `pre_hantar` → confirmation-modal → `pdsL01_button_hantar` two-stage submission.

### Milestone C — Operator Canonicalization (P1)

10. Build state / country canonicalization mapping (free-string → portal enum code) with operator review UI.
11. Build `jenis_perniagaan` capture for SSM company parties.
12. Enforce `tb_alamat_2` requirement for parties (currently optional in WeStamp).

### Milestone D — Model Extensions for Non-1103 Paths (P2)

13. Per-period rent schedule capture for `pds_jenis = 1104`, gated on Milestone B being live.
14. `par_id` capture for `pds_jenis = 1105`, gated on Milestone B being live.
15. Lampiran upload-widget instruction (post-Simpan, file upload via Playwright `setInputFiles`).

## 7. Safety Implications for the Current Codebase

Until Milestones A and B are complete:

- **No tenancy job should reach a "Ready for supervised portal run" verdict** — even where every previously-modelled required-detail field is captured.
- The run-readiness gate has been patched (in the same milestone that added this report) to hard-block on every gap listed above whose evaluation does not require data we cannot derive locally.
- The operator UI now surfaces a "Portal field mapping gaps discovered" banner explaining why submission is unsafe.
- Live portal automation, multi-pass execution, payment, certificate retrieval, OCR, and the end-user review/confirmation page remain explicitly out of scope until the model and compiler catch up.

## 8. ε-4 Recovered Option-Code Evidence (2026-04-29)

The post-A1–A4 readiness audit identified that Category C (portal enum
mismatch) blockers remained unavoidable until exact portal
`<option value>` codes were captured. The ε-4 audit recovered direct
read-only evidence — sourced verbatim from the original ε-3 supervised
field-mapping run's snap output (the `_field-mapping-cdp-output.log`
file has been deleted per the original ε-3 cleanup policy, but the
relevant `<option value> = <label>` pairs were read into context
during the Bahagian C / Perakuan / `bahagian_b_after_pds_jenis_1105`
/ `bahagian_b_after_pds_jenis_1104` snaps and are reproduced below).

**No new portal interaction occurred in the ε-4 session.** No CDP
attach was performed; no live capture was run. The evidence below is
historical recovery only.

### 8.1. `pds_harta_cat` — Kediaman (`#harta_cat_kediaman`, 9 options)

| Portal `<option value>` | Portal label |
|---|---|
| `""` | Sila pilih... (placeholder) |
| `1112` | Kembar |
| `1113` | Teres |
| `1114` | Kondominium |
| `1115` | Pangsapuri |
| `1116` | Sesebuah |
| `1117` | Rumah Pangsa |
| `1118` | Kluster |
| `1119` | Townhouse |

### 8.2. `pds_harta_cat` — Perdagangan (`#harta_cat_perdagangan`, 5 options)

| Portal `<option value>` | Portal label |
|---|---|
| `""` | Sila pilih... (placeholder) |
| `1116` | Rumah Kedai |
| `1117` | Ruang Perniagaan |
| `1118` | Ruang Pejabat |
| `1119` | Kedai Pejabat |

### 8.3. `pds_harta_cat` — Perindustrian (`#harta_cat_perindustrian`, 6 options)

| Portal `<option value>` | Portal label |
|---|---|
| `""` | Sila pilih... (placeholder) |
| `1119` | Sesebuah |
| `1120` | Kembar |
| `1121` | Teres |
| `1122` | Bertingkat (Flatted) |
| `1123` | Banglo |

### 8.4. `pds_harta_perabot` (`#pds_harta_perabot`, 3 options)

| Portal `<option value>` | Portal label |
|---|---|
| `""` | Sila pilih... (placeholder) |
| `1122` | Dengan Perabot |
| `1123` | Tanpa Perabot |

### 8.5. Notes on Code Reuse Across `<select>` Elements

The integer `<option value>` codes are scoped per `<select>` element
and are NOT globally unique. For example, `1119` means *Townhouse* in
the Kediaman dropdown but *Kedai Pejabat* in the Perdagangan dropdown
and *Sesebuah* in the Perindustrian dropdown. This means the
canonical-mapping helper must continue to dispatch by `pds_harta_type`
before resolving the per-property-type code — never assume codes are
interchangeable across property types.

### 8.6. Fields Still Uncaptured (Live Capture Required)

The ε-3 snap output reported the size of the following dropdowns but
did **not** enumerate their `<option value> = label` pairs:

- `pds_salinan` — observed as 21 options; option list NOT captured.
- `pds_harta_state` — observed as 17 options; option list NOT captured.
- `pds_harta_country` — observed as 279 options; option list NOT captured.

These three Category C blockers therefore remain unavoidable until a
future read-only capture session enumerates the option lists. Patching
WeStamp's seeded-code tables for the recovered four fields above will
flip three of the five Category C blockers from `unknown_code` to
`mapped` for the pilot path, but the remaining three blockers
(`pds_salinan_no_canonical_mapping`,
`pds_harta_state_no_canonical_mapping`,
`pds_harta_country_no_canonical_mapping`) continue to fire — by
design, because portal codes were never captured.
