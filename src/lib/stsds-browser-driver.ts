/**
 * WeStamp — STSDS Browser Driver Adapter Interface
 *
 * Defines the driver-agnostic interface contract for executing
 * browser-automation instructions against the e-Duti Setem portal.
 *
 * This is the adapter contract layer:
 * - Defines the BrowserDriverAdapter interface
 * - Each operation maps to a BrowserAutomationInstructionType
 * - Implementations (Playwright, Puppeteer, mock) conform to this interface
 *
 * Does NOT import Playwright/Puppeteer.
 * Does NOT interact with the live e-Duti Setem portal.
 * Does NOT contain any execution logic.
 */

import {
  BrowserAutomationTarget,
  BrowserAutomationPayload,
  BrowserAutomationExpectation,
  SelectorResolutionMethod,
  ReadbackConfidence,
} from "./stsds-types";

/**
 * The result of a single driver operation.
 * Implementations return this after attempting each instruction.
 */
export interface BrowserDriverOperationResult {
  /** Whether the operation completed without error. */
  success: boolean;
  /** Optional value observed from the browser after the operation. */
  observedValue?: string | null;
  /** Human-readable reason if the operation was unsuccessful. */
  failureReason?: string;
  /** Which selector strategy succeeded, if applicable. */
  selectorMethod?: SelectorResolutionMethod;
  /** Readback confidence level, if applicable. */
  readbackConfidence?: ReadbackConfidence;
  /** Readback diagnostic note, if applicable. */
  readbackNote?: string;
  /** Raw observed value before normalization, if normalization was applied. */
  rawObservedValue?: string | null;
  /**
   * Bootstrap outcome classification for navigate_to_page.
   * Granular failure stages allow truthful reporting of exactly where
   * the authenticated bootstrap flow stopped.
   */
  bootstrapOutcome?:
    | "authenticated_mytax_handoff_completed"
    | "already_on_eduti_setem"
    | "mytax_handoff_missing"
    | "old_portal_direct_fallback_used"
    | "bootstrap_failed_before_probe"
    | "failed_to_reach_mytax_dashboard"
    | "failed_to_open_ezhasil_services_menu"
    | "failed_to_open_duti_setem_submenu"
    | "failed_to_click_e_stamp_duty"
    | "failed_to_handle_sso_continue"
    | "failed_to_select_role"
    | "failed_to_reach_role_page"
    | "failed_to_click_firm_role_card"
    | "failed_to_render_firm_selection_list"
    | "failed_to_find_ejen_section"
    | "failed_to_resolve_firm_agent_target"
    | "failed_to_find_firm_target_in_role_page"
    | "failed_to_match_firm_agent_target"
    | "failed_to_click_firm_target"
    | "failed_to_confirm_role_change"
    | "failed_to_reach_eduti_dashboard"
    | "failed_to_dismiss_mytax_blocking_notice"
    | "failed_due_to_unknown_mytax_blocking_modal"
    | "popup_detected_but_button_not_found"
    | "popup_detected_but_button_not_interactable"
    | "popup_click_attempted_but_modal_remained"
    | "popup_click_attempted_but_backdrop_remained"
    | "popup_click_threw_error"
    | "popup_root_resolved_but_ok_button_not_found"
    | "popup_root_resolved_but_ok_button_not_interactable"
    | "popup_root_click_attempted_but_popup_remained"
    | "popup_root_click_attempted_but_overlay_remained"
    | "popup_root_resolution_failed"
    | "popup_ok_candidate_not_found"
    | "popup_ok_candidate_found_but_not_interactable"
    | "popup_ok_click_attempted_but_popup_remained"
    | "popup_ok_coordinate_click_attempted_but_popup_remained"
    | "popup_ok_click_threw_error"
    | "failed_to_resolve_post_login_dashboard_page"
    | "multiple_post_login_pages_ambiguous"
    | "popup_state_inconclusive_due_to_page_mismatch"
    | "final_dashboard_not_stable_before_popup_handling"
    | "popup_handling_ran_on_pre_final_page"
    | "dashboard_content_appeared_after_initial_page_selection"
    | "final_dashboard_page_changed_during_popup_handling"
    | "post_login_diagnostic_capture_completed"
    | "post_login_meaningful_signal_timeout"
    | "mytax_login_page_detected_awaiting_manual_login"
    | "mytax_loading_overlay_persisted"
    | "authenticated_state_not_reached"
    | "role_selection_page_reached"
    | "role_selection_page_not_reached"
    | "post_popup_continuation_not_entered"
    | "post_popup_continuation_threw_before_stage_2"
    | "ezhasil_menu_candidate_not_found"
    | "ezhasil_menu_candidate_found_but_not_interactable"
    | "ezhasil_menu_click_attempted_but_no_submenu"
    | "ezhasil_menu_hover_attempted_but_no_submenu"
    | "ezhasil_menu_js_click_attempted_but_no_submenu"
    | "ezhasil_menu_opened"
    | "ezhasil_text_anchor_found_but_no_clickable_wrapper"
    | "ezhasil_small_nav_wrapper_click_attempted_but_no_submenu"
    | "ezhasil_nearby_trigger_click_attempted_but_no_submenu"
    | "ezhasil_text_anchor_bbox_click_attempted_but_no_submenu"
    | "ezhasil_stage_entered_but_failed"
    | "duti_setem_stage_entered_but_failed"
    | "e_stamp_duty_stage_entered_but_failed"
    | "interstitial_stage_entered_but_failed"
    | "role_page_stage_entered_but_not_reached"
    | "e_stamp_duty_click_attempted_but_no_handoff_detected"
    | "new_tab_opened_but_not_stamps_flow"
    | "same_tab_click_attempted_but_url_unchanged"
    | "interstitial_claim_blocked_no_real_handoff"
    | "role_page_claim_blocked_not_on_role_page"
    | "e_stamp_duty_text_anchor_found_but_no_clickable_wrapper"
    | "e_stamp_duty_wrapper_click_attempted_but_url_unchanged"
    | "e_stamp_duty_bbox_click_attempted_but_url_unchanged"
    | "e_stamp_duty_new_tab_opened_but_not_stamps_flow"
    | "e_stamp_duty_handoff_completed"
    | "role_page_shell_reached"
    | "firm_card_clicked_waiting_for_hydration"
    | "role_page_shell_reached_but_firm_panel_not_loaded"
    | "firm_card_clicked_but_no_ejen_section_rendered"
    | "ejen_section_rendered_but_target_firm_missing"
    | "target_firm_visible_on_role_page"
    | "target_firm_click_attempted"
    | "target_firm_click_succeeded_but_no_confirmation_modal"
    | "confirmation_modal_detected_but_text_mismatch"
    | "confirmation_modal_detected_but_ya_click_failed"
    | "confirmation_modal_verified_and_ya_clicked"
    | "post_confirmation_landing_verified_under_target_firm"
    | "post_confirmation_landing_reached_but_firm_context_unverified"
    | "post_confirmation_navigation_failed"
    | "ya_clicked_but_destination_not_verified";
}

/**
 * Driver-agnostic adapter interface for STSDS portal browser automation.
 *
 * A concrete implementation would inject a Playwright/Puppeteer page
 * instance and wire each method to the appropriate browser action.
 *
 * This interface is intentionally minimal — it defines the contract shape
 * only. Future implementations add browser-specific internals.
 */
export interface BrowserDriverAdapter {
  /**
   * Navigate to the portal home/dashboard page.
   * Maps to instruction type: navigate_to_page
   */
  navigateToPage(
    target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Open the stamping application flow from the dashboard.
   * Maps to instruction type: open_application_flow
   */
  openApplicationFlow(
    target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Select the portal lane (sewa_pajakan / penyeteman_am).
   * Maps to instruction type: select_lane
   */
  selectLane(
    target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Fill a text input field with the provided value.
   * Maps to instruction type: fill_field
   */
  fillField(
    target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Select an option from a dropdown.
   * Maps to instruction type: select_dropdown_option
   */
  selectDropdownOption(
    target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Wait for a read-only field to become populated by the portal.
   * Maps to instruction type: wait_for_read_only_value
   */
  waitForReadOnlyValue(
    target: BrowserAutomationTarget,
    expectations: BrowserAutomationExpectation[]
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Assert that a read-only field displays the expected value.
   * Maps to instruction type: assert_read_only_value
   */
  assertReadOnlyValue(
    target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload,
    expectations: BrowserAutomationExpectation[]
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Save the current portal section/form.
   * Maps to instruction type: save_current_section
   */
  saveCurrentSection(
    target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Continue to the next portal tab.
   * Maps to instruction type: continue_to_tab
   */
  continueToTab(
    target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult>;

  /**
   * Stop and yield control for human review.
   * Maps to instruction type: stop_for_review
   */
  stopForReview(): Promise<BrowserDriverOperationResult>;
}
