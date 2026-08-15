/**
 * Hand-written to match every migration under supabase/migrations/, in the
 * exact shape `supabase gen types typescript` produces.
 *
 * Normally this file is a regenerated artifact (`npm run db:types`) — it's
 * hand-written for now only because that command shells out to
 * `docker run ... supabase/postgres-meta`, and this machine's Docker
 * Desktop VM disk is corrupted (see CLAUDE.md). Once Docker is fixed (or
 * `supabase gen types` adds a Docker-free path), regenerate and delete
 * this notice. Keep it in sync by hand until then — every column here
 * must match its migration file exactly.
 *
 * Covers: 20260729115900_init_foundation.sql, 20260729153617_teams_and_registration.sql,
 * 20260730040000_rounds_scoring_leaderboards.sql, 20260730050000_quiz_engine.sql,
 * 20260730060000_simulation.sql, 20260730070000_seed_six_rounds.sql,
 * 20260730080000_auction.sql, 20260730081000_record_locks_nullable_locked_by.sql,
 * 20260731090000_analytics_requests.sql, 20260731100000_import_error_persistence.sql,
 * 20260801090000_players_privacy.sql, 20260801093000_auction_integrity_and_qualification.sql,
 * 20260801100000_admin_identity_threading.sql, 20260801130000_seed_stages_and_simulation_config.sql,
 * 20260801133000_data_integrity_constraints.sql, 20260801140000_round_and_submission_workflow_fixes.sql,
 * 20260801143000_round_materials_storage.sql, 20260802000000_admin_reversal_and_simulation_visibility.sql,
 * 20260802010000_fix_simulation_config_placeholder_shape.sql, 20260802020000_admin_broadcast_topics.sql,
 * 20260806120000_fix_quiz_question_position_race.sql,
 * 20260807090000_fix_admin_overloads_and_quiz_position_lock.sql,
 * 20260807100000_simulation_spec_conformance.sql,
 * 20260814050000_quiz_retest_round.sql
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      event_editions: {
        Row: {
          id: string;
          name: string;
          slug: string;
          starts_on: string;
          ends_on: string;
          registration_opens_at: string | null;
          registration_closes_at: string | null;
          registration_override: "open" | "closed" | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          starts_on: string;
          ends_on: string;
          registration_opens_at?: string | null;
          registration_closes_at?: string | null;
          registration_override?: "open" | "closed" | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          starts_on?: string;
          ends_on?: string;
          registration_opens_at?: string | null;
          registration_closes_at?: string | null;
          registration_override?: "open" | "closed" | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          event_edition_id: string;
          key: string;
          value: Json;
          is_public: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          event_edition_id: string;
          key: string;
          value: Json;
          is_public?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          event_edition_id?: string;
          key?: string;
          value?: Json;
          is_public?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "settings_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          id: string;
          event_edition_id: string;
          name: string;
          campus: string;
          captain_email: string;
          status: "active" | "disqualified";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          event_edition_id: string;
          name: string;
          campus: string;
          captain_email: string;
          status?: "active" | "disqualified";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          name?: string;
          campus?: string;
          captain_email?: string;
          status?: "active" | "disqualified";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          event_edition_id: string;
          full_name: string;
          class: string;
          register_number: string;
          phone: string;
          christ_email: string;
          is_captain: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          event_edition_id: string;
          full_name: string;
          class: string;
          register_number: string;
          phone: string;
          christ_email: string;
          is_captain?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          event_edition_id?: string;
          full_name?: string;
          class?: string;
          register_number?: string;
          phone?: string;
          christ_email?: string;
          is_captain?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          team_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string;
          uploaded_at: string;
        };
        Insert: {
          team_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string;
          uploaded_at?: string;
        };
        Update: {
          team_id?: string;
          storage_path?: string;
          file_name?: string;
          mime_type?: string;
          uploaded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: true;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_events: {
        Row: {
          id: string;
          event_edition_id: string;
          team_id: string | null;
          actor_role: "team" | "admin" | "public";
          kind: string;
          detail: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          team_id?: string | null;
          actor_role: "team" | "admin" | "public";
          kind: string;
          detail?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          team_id?: string | null;
          actor_role?: "team" | "admin" | "public";
          kind?: string;
          detail?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_events_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_events_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_buckets: {
        Row: {
          bucket: string;
          key: string;
          window_start: string;
          count: number;
        };
        Insert: {
          bucket: string;
          key: string;
          window_start: string;
          count?: number;
        };
        Update: {
          bucket?: string;
          key?: string;
          window_start?: string;
          count?: number;
        };
        Relationships: [];
      };
      stages: {
        Row: {
          id: string;
          event_edition_id: string;
          code: "r1_r2" | "r3_r4" | "r6" | "final";
          label: string;
          tie_breaker_rules: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          code: "r1_r2" | "r3_r4" | "r6" | "final";
          label: string;
          tie_breaker_rules?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          code?: "r1_r2" | "r3_r4" | "r6" | "final";
          label?: string;
          tie_breaker_rules?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stages_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      rounds: {
        Row: {
          id: string;
          event_edition_id: string;
          kind: "quiz" | "submission" | "offline_info" | "simulation" | "auction" | "conference";
          sequence: number;
          slug: string;
          title: string;
          brief: string | null;
          instructions: string | null;
          opens_at: string | null;
          closes_at: string | null;
          opened_early_at: string | null;
          closed_at: string | null;
          scoring_started_at: string | null;
          scored_at: string | null;
          public_released_at: string | null;
          archived_at: string | null;
          requires_qualification_from_stage: string | null;
          rubric_total_mode: "weighted_sum" | "weighted_percent";
          supersedes_round_id: string | null;
          is_invite_only: boolean;
          quiz_exit_policy: "strict" | "lenient";
          quiz_strike_limit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          kind: "quiz" | "submission" | "offline_info" | "simulation" | "auction" | "conference";
          sequence: number;
          slug: string;
          title: string;
          brief?: string | null;
          instructions?: string | null;
          opens_at?: string | null;
          closes_at?: string | null;
          opened_early_at?: string | null;
          closed_at?: string | null;
          scoring_started_at?: string | null;
          scored_at?: string | null;
          public_released_at?: string | null;
          archived_at?: string | null;
          requires_qualification_from_stage?: string | null;
          rubric_total_mode?: "weighted_sum" | "weighted_percent";
          supersedes_round_id?: string | null;
          is_invite_only?: boolean;
          quiz_exit_policy?: "strict" | "lenient";
          quiz_strike_limit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          kind?: "quiz" | "submission" | "offline_info" | "simulation" | "auction" | "conference";
          sequence?: number;
          slug?: string;
          title?: string;
          brief?: string | null;
          instructions?: string | null;
          opens_at?: string | null;
          closes_at?: string | null;
          opened_early_at?: string | null;
          closed_at?: string | null;
          scoring_started_at?: string | null;
          scored_at?: string | null;
          public_released_at?: string | null;
          archived_at?: string | null;
          requires_qualification_from_stage?: string | null;
          rubric_total_mode?: "weighted_sum" | "weighted_percent";
          supersedes_round_id?: string | null;
          is_invite_only?: boolean;
          quiz_exit_policy?: "strict" | "lenient";
          quiz_strike_limit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rounds_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rounds_requires_qualification_from_stage_fkey";
            columns: ["requires_qualification_from_stage"];
            isOneToOne: false;
            referencedRelation: "stages";
            referencedColumns: ["id"];
          },
          {
            // isOneToOne because of the partial unique index
            // rounds_supersedes_round_id_unique: at most one round may
            // supersede any given round.
            foreignKeyName: "rounds_supersedes_round_id_fkey";
            columns: ["supersedes_round_id"];
            isOneToOne: true;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      stage_rounds: {
        Row: {
          stage_id: string;
          round_id: string;
          weight: number;
        };
        Insert: {
          stage_id: string;
          round_id: string;
          weight?: number;
        };
        Update: {
          stage_id?: string;
          round_id?: string;
          weight?: number;
        };
        Relationships: [
          {
            foreignKeyName: "stage_rounds_stage_id_fkey";
            columns: ["stage_id"];
            isOneToOne: false;
            referencedRelation: "stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stage_rounds_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      round_materials: {
        Row: {
          id: string;
          round_id: string;
          kind: "file" | "link" | "text";
          title: string;
          storage_path: string | null;
          url: string | null;
          body: string | null;
          public_release: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          kind: "file" | "link" | "text";
          title: string;
          storage_path?: string | null;
          url?: string | null;
          body?: string | null;
          public_release?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          kind?: "file" | "link" | "text";
          title?: string;
          storage_path?: string | null;
          url?: string | null;
          body?: string | null;
          public_release?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "round_materials_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      submissions: {
        Row: {
          id: string;
          round_id: string;
          team_id: string;
          status: "not_submitted" | "submitted";
          submitted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          team_id: string;
          status?: "not_submitted" | "submitted";
          submitted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          team_id?: string;
          status?: "not_submitted" | "submitted";
          submitted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submissions_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      submission_files: {
        // storage_path/mime_type are null on a shared-link row and
        // external_url is null on an uploaded one — exactly one of the two
        // is set (submission_files_object_xor_link, migration
        // 20260815110000).
        Row: {
          id: string;
          submission_id: string;
          storage_path: string | null;
          external_url: string | null;
          file_name: string;
          mime_type: string | null;
          uploaded_at: string;
          superseded_at: string | null;
        };
        Insert: {
          id?: string;
          submission_id: string;
          storage_path?: string | null;
          external_url?: string | null;
          file_name: string;
          mime_type?: string | null;
          uploaded_at?: string;
          superseded_at?: string | null;
        };
        Update: {
          id?: string;
          submission_id?: string;
          storage_path?: string | null;
          external_url?: string | null;
          file_name?: string;
          mime_type?: string | null;
          uploaded_at?: string;
          superseded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "submission_files_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      rubric_criteria: {
        Row: {
          id: string;
          round_id: string;
          label: string;
          max_value: number;
          weight: number;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          label: string;
          max_value: number;
          weight?: number;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          label?: string;
          max_value?: number;
          weight?: number;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rubric_criteria_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      scores: {
        Row: {
          id: string;
          round_id: string;
          team_id: string;
          total: number;
          max_total: number | null;
          source: "manual" | "quiz" | "simulation";
          published: boolean;
          notes: string | null;
          entered_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          team_id: string;
          total?: number;
          max_total?: number | null;
          source?: "manual" | "quiz" | "simulation";
          published?: boolean;
          notes?: string | null;
          entered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          team_id?: string;
          total?: number;
          max_total?: number | null;
          source?: "manual" | "quiz" | "simulation";
          published?: boolean;
          notes?: string | null;
          entered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scores_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scores_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      score_criterion_values: {
        Row: {
          id: string;
          score_id: string;
          criterion_id: string;
          value: number;
        };
        Insert: {
          id?: string;
          score_id: string;
          criterion_id: string;
          value: number;
        };
        Update: {
          id?: string;
          score_id?: string;
          criterion_id?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "score_criterion_values_score_id_fkey";
            columns: ["score_id"];
            isOneToOne: false;
            referencedRelation: "scores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "score_criterion_values_criterion_id_fkey";
            columns: ["criterion_id"];
            isOneToOne: false;
            referencedRelation: "rubric_criteria";
            referencedColumns: ["id"];
          },
        ];
      };
      stage_adjustments: {
        Row: {
          id: string;
          stage_id: string;
          team_id: string;
          amount: number;
          reason: string;
          source_ref: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          stage_id: string;
          team_id: string;
          amount: number;
          reason: string;
          source_ref?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          stage_id?: string;
          team_id?: string;
          amount?: number;
          reason?: string;
          source_ref?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stage_adjustments_stage_id_fkey";
            columns: ["stage_id"];
            isOneToOne: false;
            referencedRelation: "stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stage_adjustments_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      qualifications: {
        Row: {
          id: string;
          stage_id: string;
          team_id: string;
          rank: number | null;
          aggregate_snapshot: Json;
          decision: "pending" | "qualified" | "eliminated";
          decided_at: string | null;
          decided_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          stage_id: string;
          team_id: string;
          rank?: number | null;
          aggregate_snapshot?: Json;
          decision?: "pending" | "qualified" | "eliminated";
          decided_at?: string | null;
          decided_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          stage_id?: string;
          team_id?: string;
          rank?: number | null;
          aggregate_snapshot?: Json;
          decision?: "pending" | "qualified" | "eliminated";
          decided_at?: string | null;
          decided_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "qualifications_stage_id_fkey";
            columns: ["stage_id"];
            isOneToOne: false;
            referencedRelation: "stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "qualifications_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      leaderboard_snapshots: {
        Row: {
          id: string;
          event_edition_id: string;
          kind: "top_15" | "final_top_10";
          entry_limit: number;
          published_at: string;
          hidden_at: string | null;
          published_by: string | null;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          kind: "top_15" | "final_top_10";
          entry_limit: number;
          published_at?: string;
          hidden_at?: string | null;
          published_by?: string | null;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          kind?: "top_15" | "final_top_10";
          entry_limit?: number;
          published_at?: string;
          hidden_at?: string | null;
          published_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "leaderboard_snapshots_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      leaderboard_snapshot_entries: {
        Row: {
          id: string;
          snapshot_id: string;
          rank: number;
          team_name: string;
          score: number;
        };
        Insert: {
          id?: string;
          snapshot_id: string;
          rank: number;
          team_name: string;
          score: number;
        };
        Update: {
          id?: string;
          snapshot_id?: string;
          rank?: number;
          team_name?: string;
          score?: number;
        };
        Relationships: [
          {
            foreignKeyName: "leaderboard_snapshot_entries_snapshot_id_fkey";
            columns: ["snapshot_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_snapshots";
            referencedColumns: ["id"];
          },
        ];
      };
      announcements: {
        Row: {
          id: string;
          event_edition_id: string;
          audience: "all" | "team" | "public";
          message: string;
          visibility: "draft" | "published";
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          audience: "all" | "team" | "public";
          message: string;
          visibility?: "draft" | "published";
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          audience?: "all" | "team" | "public";
          message?: string;
          visibility?: "draft" | "published";
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "announcements_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_questions: {
        Row: {
          id: string;
          round_id: string;
          event_edition_id: string;
          position: number;
          prompt: string;
          timer_seconds: number;
          weight: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          event_edition_id: string;
          position: number;
          prompt: string;
          timer_seconds?: number;
          weight?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          event_edition_id?: string;
          position?: number;
          prompt?: string;
          timer_seconds?: number;
          weight?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_questions_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_options: {
        Row: {
          id: string;
          question_id: string;
          position: number;
          label: string;
          is_correct: boolean;
        };
        Insert: {
          id?: string;
          question_id: string;
          position: number;
          label: string;
          is_correct?: boolean;
        };
        Update: {
          id?: string;
          question_id?: string;
          position?: number;
          label?: string;
          is_correct?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_options_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "quiz_questions";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_attempts: {
        Row: {
          id: string;
          round_id: string;
          team_id: string;
          event_edition_id: string;
          question_order: string[];
          timer_seconds: number[];
          started_at: string;
          scheduled_ends_at: string;
          status: "in_progress" | "submitted" | "archived";
          submitted_at: string | null;
          submit_reason:
            | "completed"
            | "timeout"
            | "fullscreen_exit"
            | "visibility_hidden"
            | "page_hidden"
            | "navigation"
            | "manual"
            | "admin"
            | null;
          raw_score: number | null;
          max_score: number | null;
          percent: number | null;
          correct_count: number | null;
          question_count: number | null;
          session_token: string;
          session_seen_at: string;
          strike_count: number;
          last_strike_at: string | null;
          last_strike_kind: string | null;
          warning_ack_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          team_id: string;
          event_edition_id: string;
          question_order: string[];
          timer_seconds: number[];
          started_at?: string;
          scheduled_ends_at: string;
          status?: "in_progress" | "submitted" | "archived";
          submitted_at?: string | null;
          submit_reason?:
            | "completed"
            | "timeout"
            | "fullscreen_exit"
            | "visibility_hidden"
            | "page_hidden"
            | "navigation"
            | "manual"
            | "admin"
            | null;
          raw_score?: number | null;
          max_score?: number | null;
          percent?: number | null;
          correct_count?: number | null;
          question_count?: number | null;
          session_token?: string;
          session_seen_at?: string;
          strike_count?: number;
          last_strike_at?: string | null;
          last_strike_kind?: string | null;
          warning_ack_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          team_id?: string;
          event_edition_id?: string;
          question_order?: string[];
          timer_seconds?: number[];
          started_at?: string;
          scheduled_ends_at?: string;
          status?: "in_progress" | "submitted" | "archived";
          submitted_at?: string | null;
          submit_reason?:
            | "completed"
            | "timeout"
            | "fullscreen_exit"
            | "visibility_hidden"
            | "page_hidden"
            | "navigation"
            | "manual"
            | "admin"
            | null;
          raw_score?: number | null;
          max_score?: number | null;
          percent?: number | null;
          correct_count?: number | null;
          question_count?: number | null;
          session_token?: string;
          session_seen_at?: string;
          strike_count?: number;
          last_strike_at?: string | null;
          last_strike_kind?: string | null;
          warning_ack_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_attempts_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_answers: {
        Row: {
          id: string;
          attempt_id: string;
          question_id: string;
          option_id: string;
          answered_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          question_id: string;
          option_id: string;
          answered_at?: string;
        };
        Update: {
          id?: string;
          attempt_id?: string;
          question_id?: string;
          option_id?: string;
          answered_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_answers_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "quiz_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_answers_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "quiz_questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_answers_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "quiz_options";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_events: {
        Row: {
          id: string;
          attempt_id: string;
          kind: string;
          detail: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          kind: string;
          detail?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          attempt_id?: string;
          kind?: string;
          detail?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_events_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "quiz_attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      round_eligible_teams: {
        Row: {
          round_id: string;
          team_id: string;
          event_edition_id: string;
          reason: string | null;
          added_by: string | null;
          created_at: string;
        };
        Insert: {
          round_id: string;
          team_id: string;
          event_edition_id: string;
          reason?: string | null;
          added_by?: string | null;
          created_at?: string;
        };
        Update: {
          round_id?: string;
          team_id?: string;
          event_edition_id?: string;
          reason?: string | null;
          added_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "round_eligible_teams_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "round_eligible_teams_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "round_eligible_teams_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      simulation_config: {
        Row: {
          id: string;
          event_edition_id: string;
          round_id: string | null;
          parameters: Json;
          scoring: Json;
          answer_key: Json;
          global_timer_seconds: number;
          submit_cooldown_seconds: number;
          started_at: string | null;
          stopped_at: string | null;
          visible_at: string | null;
          winner_count: number;
          defaults_overall: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          round_id?: string | null;
          parameters: Json;
          scoring: Json;
          answer_key: Json;
          global_timer_seconds?: number;
          submit_cooldown_seconds?: number;
          started_at?: string | null;
          stopped_at?: string | null;
          visible_at?: string | null;
          winner_count?: number;
          defaults_overall: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          round_id?: string | null;
          parameters?: Json;
          scoring?: Json;
          answer_key?: Json;
          global_timer_seconds?: number;
          submit_cooldown_seconds?: number;
          started_at?: string | null;
          stopped_at?: string | null;
          visible_at?: string | null;
          winner_count?: number;
          defaults_overall?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "simulation_config_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "simulation_config_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      simulation_attempts: {
        Row: {
          id: string;
          config_id: string;
          team_id: string;
          submitted_parameters: Json;
          sub_scores: Json;
          overall: number;
          success: boolean;
          winner_rank: number | null;
          server_ts: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          config_id: string;
          team_id: string;
          submitted_parameters: Json;
          sub_scores: Json;
          overall: number;
          success?: boolean;
          winner_rank?: number | null;
          server_ts?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          config_id?: string;
          team_id?: string;
          submitted_parameters?: Json;
          sub_scores?: Json;
          overall?: number;
          success?: boolean;
          winner_rank?: number | null;
          server_ts?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "simulation_attempts_config_id_fkey";
            columns: ["config_id"];
            isOneToOne: false;
            referencedRelation: "simulation_config";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "simulation_attempts_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      simulation_rewards: {
        Row: {
          id: string;
          config_id: string;
          team_id: string;
          attempt_id: string | null;
          reward_kind: "marks" | "purse";
          amount: number;
          target_round_id: string | null;
          purse_applied_at: string | null;
          purse_ledger_entry_id: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          config_id: string;
          team_id: string;
          attempt_id?: string | null;
          reward_kind: "marks" | "purse";
          amount: number;
          target_round_id?: string | null;
          purse_applied_at?: string | null;
          purse_ledger_entry_id?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          config_id?: string;
          team_id?: string;
          attempt_id?: string | null;
          reward_kind?: "marks" | "purse";
          amount?: number;
          target_round_id?: string | null;
          purse_applied_at?: string | null;
          purse_ledger_entry_id?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "simulation_rewards_config_id_fkey";
            columns: ["config_id"];
            isOneToOne: false;
            referencedRelation: "simulation_config";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "simulation_rewards_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "simulation_rewards_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "simulation_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "simulation_rewards_purse_ledger_entry_id_fkey";
            columns: ["purse_ledger_entry_id"];
            isOneToOne: false;
            referencedRelation: "purse_ledger";
            referencedColumns: ["id"];
          },
        ];
      };
      player_stat_definitions: {
        Row: {
          id: string;
          event_edition_id: string;
          key: string;
          label: string;
          data_type: "number" | "text" | "boolean";
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          key: string;
          label: string;
          data_type: "number" | "text" | "boolean";
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          key?: string;
          label?: string;
          data_type?: "number" | "text" | "boolean";
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_stat_definitions_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
      players: {
        Row: {
          id: string;
          event_edition_id: string;
          round_id: string | null;
          external_ref: string | null;
          full_name: string;
          role: string;
          base_price: number;
          pool: string;
          nationality: string;
          is_overseas: boolean;
          ipl_team: string | null;
          stats: Json;
          status: "available" | "active" | "sold" | "unsold" | "recalled";
          current_team_id: string | null;
          sale_price: number | null;
          sold_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          round_id?: string | null;
          external_ref?: string | null;
          full_name: string;
          role: string;
          base_price: number;
          pool: string;
          nationality: string;
          is_overseas?: boolean;
          ipl_team?: string | null;
          stats?: Json;
          status?: "available" | "active" | "sold" | "unsold" | "recalled";
          current_team_id?: string | null;
          sale_price?: number | null;
          sold_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          round_id?: string | null;
          external_ref?: string | null;
          full_name?: string;
          role?: string;
          base_price?: number;
          pool?: string;
          nationality?: string;
          is_overseas?: boolean;
          ipl_team?: string | null;
          stats?: Json;
          status?: "available" | "active" | "sold" | "unsold" | "recalled";
          current_team_id?: string | null;
          sale_price?: number | null;
          sold_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "players_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "players_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "players_current_team_id_fkey";
            columns: ["current_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      auction_rule_sets: {
        Row: {
          id: string;
          event_edition_id: string;
          round_id: string | null;
          is_active: boolean;
          starting_purse: number;
          min_squad_size: number;
          max_squad_size: number;
          max_overseas: number;
          role_limits: Json;
          pool_limits: Json;
          analytics_price: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          round_id?: string | null;
          is_active?: boolean;
          starting_purse?: number;
          min_squad_size?: number;
          max_squad_size?: number;
          max_overseas?: number;
          role_limits?: Json;
          pool_limits?: Json;
          analytics_price?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          round_id?: string | null;
          is_active?: boolean;
          starting_purse?: number;
          min_squad_size?: number;
          max_squad_size?: number;
          max_overseas?: number;
          role_limits?: Json;
          pool_limits?: Json;
          analytics_price?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auction_rule_sets_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auction_rule_sets_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      purse_ledger: {
        Row: {
          id: string;
          event_edition_id: string;
          team_id: string;
          entry_kind: "start" | "sim_bonus" | "purchase" | "reversal" | "analytics" | "adjustment";
          amount: number;
          ref_kind: string | null;
          ref_id: string | null;
          memo: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          team_id: string;
          entry_kind: "start" | "sim_bonus" | "purchase" | "reversal" | "analytics" | "adjustment";
          amount: number;
          ref_kind?: string | null;
          ref_id?: string | null;
          memo?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          team_id?: string;
          entry_kind?: "start" | "sim_bonus" | "purchase" | "reversal" | "analytics" | "adjustment";
          amount?: number;
          ref_kind?: string | null;
          ref_id?: string | null;
          memo?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purse_ledger_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purse_ledger_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      auction_state: {
        Row: {
          event_edition_id: string;
          round_id: string | null;
          active_player_id: string | null;
          started_at: string | null;
          ended_at: string | null;
          ended_by: string | null;
          updated_at: string;
        };
        Insert: {
          event_edition_id: string;
          round_id?: string | null;
          active_player_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          ended_by?: string | null;
          updated_at?: string;
        };
        Update: {
          event_edition_id?: string;
          round_id?: string | null;
          active_player_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          ended_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auction_state_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: true;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auction_state_active_player_id_fkey";
            columns: ["active_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_requests: {
        Row: {
          id: string;
          event_edition_id: string;
          team_id: string;
          status: "pending" | "approved" | "rejected" | "revoked";
          price_at_request: number;
          price_charged: number | null;
          requested_by: string | null;
          requested_at: string;
          approved_at: string | null;
          approved_by: string | null;
          rejected_at: string | null;
          rejected_by: string | null;
          rejection_reason: string | null;
          purse_ledger_entry_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          team_id: string;
          status?: "pending" | "approved" | "rejected" | "revoked";
          price_at_request: number;
          price_charged?: number | null;
          requested_by?: string | null;
          requested_at?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          purse_ledger_entry_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          team_id?: string;
          status?: "pending" | "approved" | "rejected" | "revoked";
          price_at_request?: number;
          price_charged?: number | null;
          requested_by?: string | null;
          requested_at?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          purse_ledger_entry_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_requests_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analytics_requests_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analytics_requests_purse_ledger_entry_id_fkey";
            columns: ["purse_ledger_entry_id"];
            isOneToOne: false;
            referencedRelation: "purse_ledger";
            referencedColumns: ["id"];
          },
        ];
      };
      record_locks: {
        Row: {
          record_type: "player" | "sale";
          record_id: string;
          locked_by: string | null;
          device_label: string | null;
          session_token: string;
          acquired_at: string;
          heartbeat_at: string;
        };
        Insert: {
          record_type: "player" | "sale";
          record_id: string;
          locked_by?: string | null;
          device_label?: string | null;
          session_token?: string;
          acquired_at?: string;
          heartbeat_at?: string;
        };
        Update: {
          record_type?: "player" | "sale";
          record_id?: string;
          locked_by?: string | null;
          device_label?: string | null;
          session_token?: string;
          acquired_at?: string;
          heartbeat_at?: string;
        };
        Relationships: [];
      };
      auction_sales: {
        Row: {
          id: string;
          event_edition_id: string;
          player_id: string;
          team_id: string;
          amount: number;
          sold_at: string;
          sold_by: string | null;
          reversed_at: string | null;
          reversed_by: string | null;
          reversal_reason: string | null;
          purse_ledger_entry_id: string | null;
          reversal_ledger_entry_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          player_id: string;
          team_id: string;
          amount: number;
          sold_at?: string;
          sold_by?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          reversal_reason?: string | null;
          purse_ledger_entry_id?: string | null;
          reversal_ledger_entry_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          player_id?: string;
          team_id?: string;
          amount?: number;
          sold_at?: string;
          sold_by?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          reversal_reason?: string | null;
          purse_ledger_entry_id?: string | null;
          reversal_ledger_entry_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auction_sales_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auction_sales_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      auction_audit_events: {
        Row: {
          id: string;
          event_edition_id: string;
          kind:
            | "player_imported"
            | "player_edited"
            | "player_activated"
            | "player_sold"
            | "player_unsold"
            | "player_recalled"
            | "sale_reversed"
            | "rule_set_saved"
            | "auction_started"
            | "auction_ended"
            | "simulation_purse_applied";
          player_id: string | null;
          team_id: string | null;
          sale_id: string | null;
          actor_id: string | null;
          before_state: Json | null;
          after_state: Json | null;
          detail: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_edition_id: string;
          kind:
            | "player_imported"
            | "player_edited"
            | "player_activated"
            | "player_sold"
            | "player_unsold"
            | "player_recalled"
            | "sale_reversed"
            | "rule_set_saved"
            | "auction_started"
            | "auction_ended"
            | "simulation_purse_applied";
          player_id?: string | null;
          team_id?: string | null;
          sale_id?: string | null;
          actor_id?: string | null;
          before_state?: Json | null;
          after_state?: Json | null;
          detail?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_edition_id?: string;
          kind?:
            | "player_imported"
            | "player_edited"
            | "player_activated"
            | "player_sold"
            | "player_unsold"
            | "player_recalled"
            | "sale_reversed"
            | "rule_set_saved"
            | "auction_started"
            | "auction_ended"
            | "simulation_purse_applied";
          player_id?: string | null;
          team_id?: string | null;
          sale_id?: string | null;
          actor_id?: string | null;
          before_state?: Json | null;
          after_state?: Json | null;
          detail?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auction_audit_events_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auction_audit_events_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auction_audit_events_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "auction_sales";
            referencedColumns: ["id"];
          },
        ];
      };
      live_broadcast: {
        Row: {
          id: number;
          event_edition_id: string;
          topic: string;
          kind: string;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: number;
          event_edition_id: string;
          topic: string;
          kind: string;
          payload?: Json;
          created_at?: string;
        };
        Update: {
          id?: number;
          event_edition_id?: string;
          topic?: string;
          kind?: string;
          payload?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "live_broadcast_event_edition_id_fkey";
            columns: ["event_edition_id"];
            isOneToOne: false;
            referencedRelation: "event_editions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      pending_simulation_purse_awards: {
        Row: {
          simulation_reward_id: string;
          team_id: string;
          amount: number;
          event_edition_id: string;
          winner_rank: number | null;
        };
        Relationships: [];
      };
      rounds_with_status: {
        Row: {
          id: string;
          event_edition_id: string;
          kind: "quiz" | "submission" | "offline_info" | "simulation" | "auction" | "conference";
          sequence: number;
          slug: string;
          title: string;
          brief: string | null;
          instructions: string | null;
          opens_at: string | null;
          closes_at: string | null;
          opened_early_at: string | null;
          closed_at: string | null;
          scoring_started_at: string | null;
          scored_at: string | null;
          public_released_at: string | null;
          archived_at: string | null;
          requires_qualification_from_stage: string | null;
          rubric_total_mode: "weighted_sum" | "weighted_percent";
          supersedes_round_id: string | null;
          is_invite_only: boolean;
          quiz_exit_policy: "strict" | "lenient";
          quiz_strike_limit: number;
          created_at: string;
          updated_at: string;
          status: string;
        };
        Relationships: [];
      };
      team_purse_balances: {
        Row: {
          team_id: string;
          event_edition_id: string;
          balance: number;
        };
        Relationships: [];
      };
      public_team_purses: {
        Row: {
          team_id: string;
          event_edition_id: string;
          name: string;
          campus: string;
          purse_balance: number;
        };
        Relationships: [];
      };
      public_sales_feed: {
        Row: {
          id: string;
          player_id: string;
          player_name: string;
          role: string;
          pool: string;
          team_id: string;
          team_name: string;
          amount: number;
          sold_at: string;
          reversed_at: string | null;
          reversal_reason: string | null;
        };
        Relationships: [];
      };
      public_analytics_status: {
        Row: {
          team_id: string;
          event_edition_id: string;
          status: "locked" | "purchased";
        };
        Relationships: [];
      };
      players_public: {
        Row: {
          id: string;
          event_edition_id: string;
          round_id: string | null;
          external_ref: string | null;
          full_name: string;
          role: string;
          base_price: number;
          pool: string;
          nationality: string;
          is_overseas: boolean;
          ipl_team: string | null;
          status: "available" | "active" | "sold" | "unsold" | "recalled";
          current_team_id: string | null;
          sale_price: number | null;
          sold_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_registration_open: {
        Args: { p_event_edition_id: string };
        Returns: boolean;
      };
      // EXECUTE on the four below is granted to service_role only (migration
      // 002) — anon/authenticated get a permission-denied from Postgres if
      // they ever call them. Typed here anyway because the *admin* client
      // (src/lib/supabase/admin.ts) is also a SupabaseClient<Database> and
      // should get real Args/Returns types for its .rpc() calls.
      register_team: {
        Args: {
          p_auth_user_id: string;
          p_event_edition_id: string;
          p_team_name: string;
          p_campus: string;
          p_members: Json;
          p_invoice_storage_path: string;
          p_invoice_file_name: string;
          p_invoice_mime_type: string;
        };
        Returns: string;
      };
      admin_update_team: {
        Args: {
          p_team_id: string;
          p_expected_updated_at: string;
          p_name: string;
          p_campus: string;
          p_members: Json;
        };
        Returns: undefined;
      };
      check_rate_limit: {
        Args: {
          p_bucket: string;
          p_key: string;
          p_max_count: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
      log_activity: {
        Args: {
          p_event_edition_id: string;
          p_team_id: string | null;
          p_actor_role: string;
          p_kind: string;
          p_detail?: Json;
        };
        Returns: undefined;
      };
      // effective_round_status() takes a "rounds" row type argument, which
      // PostgREST/postgrest-js cannot express as an .rpc() call — it is only
      // ever invoked from SQL (rounds_with_status, other functions). Typed
      // here for completeness, not for calling.
      effective_round_status: {
        Args: { r: unknown };
        Returns: string;
      };
      // Read-only, self-guarded (see migration 003 comment) — the one
      // exception granted to authenticated directly, not just service_role.
      can_team_submit: {
        Args: { p_round_id: string; p_team_id: string };
        Returns: boolean;
      };
      submit_round_files: {
        Args: { p_team_id: string; p_round_id: string; p_files: Json };
        Returns: string;
      };
      admin_upsert_round: {
        Args: {
          p_round_id: string | null;
          p_expected_updated_at: string | null;
          p_event_edition_id: string;
          p_kind: string;
          p_sequence: number;
          p_slug: string;
          p_title: string;
          p_brief: string | null;
          p_instructions: string | null;
          p_opens_at: string | null;
          p_closes_at: string | null;
          p_requires_qualification_from_stage: string | null;
          p_rubric_total_mode: string;
        };
        Returns: string;
      };
      admin_set_round_lifecycle: {
        Args: { p_round_id: string; p_action: string; p_admin_id?: string | null; p_reason?: string | null };
        Returns: undefined;
      };
      admin_upsert_round_material: {
        Args: {
          p_material_id: string | null;
          p_round_id: string;
          p_kind: string;
          p_title: string;
          p_storage_path: string | null;
          p_url: string | null;
          p_body: string | null;
          p_public_release: boolean;
          p_position: number;
        };
        Returns: string;
      };
      admin_delete_round_material: {
        Args: { p_material_id: string };
        Returns: undefined;
      };
      admin_upsert_rubric_criterion: {
        Args: {
          p_criterion_id: string | null;
          p_round_id: string;
          p_label: string;
          p_max_value: number;
          p_weight: number;
          p_position: number;
        };
        Returns: string;
      };
      admin_delete_rubric_criterion: {
        Args: { p_criterion_id: string };
        Returns: undefined;
      };
      admin_save_score: {
        Args: {
          p_round_id: string;
          p_team_id: string;
          p_expected_updated_at: string | null;
          p_total: number;
          p_max_total: number | null;
          p_criterion_values: Json | null;
          p_notes: string | null;
          p_admin_id: string;
        };
        Returns: string;
      };
      admin_set_score_published: {
        Args: { p_score_id: string; p_published: boolean };
        Returns: undefined;
      };
      admin_publish_scores_for_round: {
        Args: { p_round_id: string };
        Returns: number;
      };
      stage_standings: {
        Args: { p_stage_id: string };
        Returns: { team_id: string; team_name: string; aggregate: number; rank: number }[];
      };
      admin_set_stage_rounds: {
        Args: { p_stage_id: string; p_round_weights: Json };
        Returns: undefined;
      };
      admin_add_stage_adjustment: {
        Args: {
          p_stage_id: string;
          p_team_id: string;
          p_amount: number;
          p_reason: string;
          p_source_ref: string | null;
          p_admin_id: string;
        };
        Returns: string;
      };
      admin_confirm_qualifications: {
        Args: { p_stage_id: string; p_decisions: Json; p_admin_id: string };
        Returns: undefined;
      };
      admin_publish_leaderboard: {
        Args: {
          p_event_edition_id: string;
          p_kind: string;
          p_entries: Json;
          p_entry_limit: number;
          p_admin_id: string;
        };
        Returns: string;
      };
      admin_hide_leaderboard: {
        Args: { p_snapshot_id: string };
        Returns: undefined;
      };
      admin_upsert_announcement: {
        Args: {
          p_announcement_id: string | null;
          p_event_edition_id: string;
          p_audience: string;
          p_message: string;
          p_visibility: string;
          p_admin_id: string;
        };
        Returns: string;
      };
      // quiz_current_index() takes a "quiz_attempts" row argument, like
      // effective_round_status() — not callable via .rpc(), typed for
      // completeness only.
      quiz_current_index: {
        Args: { p_attempt: unknown };
        Returns: { idx: number; question_closes_at: string }[];
      };
      start_quiz_attempt: {
        Args: { p_team_id: string; p_round_id: string };
        Returns: Json;
      };
      get_quiz_state: {
        Args: { p_team_id: string; p_round_id: string; p_session_token: string };
        Returns: Json;
      };
      save_quiz_answer: {
        Args: {
          p_team_id: string;
          p_round_id: string;
          p_session_token: string;
          p_question_id: string;
          p_option_id: string;
        };
        Returns: undefined;
      };
      submit_quiz_attempt: {
        Args: { p_team_id: string; p_round_id: string; p_reason: string; p_session_token: string };
        Returns: Json;
      };
      log_quiz_events: {
        Args: { p_team_id: string; p_round_id: string; p_session_token: string; p_events: Json };
        Returns: number;
      };
      record_quiz_strike: {
        Args: {
          p_team_id: string;
          p_round_id: string;
          p_session_token: string;
          p_kind: string;
        };
        Returns: Json;
      };
      ack_quiz_warning: {
        Args: { p_team_id: string; p_round_id: string; p_session_token: string };
        Returns: undefined;
      };
      resume_quiz_attempt: {
        Args: { p_team_id: string; p_round_id: string };
        Returns: Json;
      };
      team_is_round_eligible: {
        Args: { p_round_id: string; p_team_id: string };
        Returns: boolean;
      };
      admin_set_round_eligibility: {
        Args: {
          p_round_id: string;
          p_team_ids: string[];
          p_admin_id?: string | null;
          p_reason?: string | null;
        };
        Returns: number;
      };
      admin_add_round_eligible_team: {
        Args: {
          p_round_id: string;
          p_team_id: string;
          p_reason?: string | null;
          p_admin_id?: string | null;
        };
        Returns: undefined;
      };
      admin_remove_round_eligible_team: {
        Args: { p_round_id: string; p_team_id: string; p_admin_id?: string | null };
        Returns: undefined;
      };
      admin_set_round_policy: {
        Args: {
          p_round_id: string;
          p_supersedes_round_id: string | null;
          p_is_invite_only: boolean;
          p_quiz_exit_policy: string;
          p_quiz_strike_limit: number;
          p_admin_id?: string | null;
        };
        Returns: undefined;
      };
      tick_quiz_attempts: {
        Args: Record<string, never>;
        Returns: number;
      };
      admin_reset_quiz_attempt: {
        Args: { p_attempt_id: string; p_reason: string };
        Returns: undefined;
      };
      validate_quiz_bank: {
        Args: { p_round_id: string };
        Returns: Json;
      };
      admin_upsert_quiz_question: {
        Args: {
          p_question_id: string | null;
          p_round_id: string;
          p_position: number;
          p_prompt: string;
          p_timer_seconds: number;
          p_weight: number;
          p_is_active: boolean;
          p_options: Json;
        };
        Returns: string;
      };
      admin_delete_quiz_question: {
        Args: { p_question_id: string };
        Returns: undefined;
      };
      // Takes a "simulation_config" row argument, like effective_round_status()
      // — not callable via .rpc(), typed for completeness only.
      simulation_evaluate: {
        Args: { p_config: unknown; p_parameters: Json };
        Returns: Json;
      };
      simulation_status: {
        Args: { p_config_id: string };
        Returns: Json;
      };
      submit_simulation_attempt: {
        Args: { p_team_id: string; p_config_id: string; p_parameters: Json };
        Returns: Json;
      };
      admin_save_simulation_config: {
        Args: {
          p_config_id: string | null;
          p_expected_updated_at: string | null;
          p_event_edition_id: string;
          p_round_id: string | null;
          p_parameters: Json;
          p_scoring: Json;
          p_answer_key: Json;
          p_global_timer_seconds: number;
          p_submit_cooldown_seconds: number;
        };
        Returns: string;
      };
      admin_set_simulation_lifecycle: {
        Args: { p_config_id: string; p_action: string; p_admin_id?: string | null; p_reason?: string | null };
        Returns: undefined;
      };
      reverse_simulation_reward: {
        Args: { p_config_id: string; p_team_id: string; p_admin_id: string; p_reason: string };
        Returns: Json;
      };
      admin_confirm_simulation_reward: {
        Args: {
          p_config_id: string;
          p_team_id: string;
          p_attempt_id: string | null;
          p_reward_kind: string;
          p_amount: number;
          p_target_round_id: string | null;
          p_reason: string | null;
          p_admin_id: string;
        };
        Returns: string;
      };
      admin_regenerate_simulation_answer_keys: {
        Args: { p_config_id: string; p_admin_id: string; p_reason: string };
        Returns: undefined;
      };
      simulation_generate_answer_key: {
        Args: { p_parameters: Json };
        Returns: Json;
      };
      simulation_default_parameters: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      simulation_default_scoring: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      seed_simulation_config: {
        Args: { p_event_edition_id: string };
        Returns: string;
      };
      admin_grant_starting_purses: {
        Args: { p_event_edition_id: string; p_admin_id: string };
        Returns: number;
      };
      admin_apply_pending_simulation_rewards: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      admin_import_players: {
        Args: { p_event_edition_id: string; p_round_id: string | null; p_rows: Json };
        Returns: Json;
      };
      admin_upsert_player: {
        Args: {
          p_player_id: string | null;
          p_expected_updated_at: string | null;
          p_event_edition_id: string;
          p_round_id: string | null;
          p_full_name: string;
          p_role: string;
          p_base_price: number;
          p_pool: string;
          p_nationality: string;
          p_is_overseas: boolean;
          p_ipl_team: string | null;
          p_stats: Json;
        };
        Returns: string;
      };
      admin_save_auction_rule_set: {
        Args: {
          p_rule_set_id: string | null;
          p_expected_updated_at: string | null;
          p_event_edition_id: string;
          p_round_id: string | null;
          p_starting_purse: number;
          p_min_squad_size: number;
          p_max_squad_size: number;
          p_max_overseas: number;
          p_role_limits: Json;
          p_pool_limits: Json;
          p_analytics_price: number;
        };
        Returns: string;
      };
      acquire_record_lock: {
        Args: {
          p_record_type: string;
          p_record_id: string;
          p_device_label: string | null;
          p_admin_id: string;
        };
        Returns: Json;
      };
      heartbeat_record_lock: {
        Args: { p_record_type: string; p_record_id: string; p_session_token: string };
        Returns: undefined;
      };
      release_record_lock: {
        Args: { p_record_type: string; p_record_id: string; p_session_token: string };
        Returns: undefined;
      };
      record_sale: {
        Args: {
          p_player_id: string;
          p_team_id: string;
          p_amount: number;
          p_expected_player_updated_at: string;
          p_admin_id: string;
        };
        Returns: Json;
      };
      reverse_sale: {
        Args: {
          p_sale_id: string;
          p_reason: string;
          p_expected_player_updated_at: string;
          p_admin_id: string;
        };
        Returns: Json;
      };
      set_active_player: {
        Args: { p_player_id: string; p_expected_updated_at: string; p_admin_id: string };
        Returns: Json;
      };
      mark_player_unsold: {
        Args: { p_player_id: string; p_expected_updated_at: string; p_admin_id: string };
        Returns: Json;
      };
      recall_player: {
        Args: {
          p_player_id: string;
          p_new_pool: string | null;
          p_expected_updated_at: string;
          p_admin_id: string;
        };
        Returns: Json;
      };
      end_auction: {
        Args: { p_event_edition_id: string; p_admin_id: string };
        Returns: undefined;
      };
      broadcast_live: {
        Args: { p_event_edition_id: string; p_topic: string; p_kind: string; p_payload: Json };
        Returns: undefined;
      };
      request_analytics: {
        Args: { p_team_id: string };
        Returns: Json;
      };
      approve_analytics: {
        Args: { p_request_id: string; p_admin_id: string };
        Returns: Json;
      };
      reject_analytics: {
        Args: { p_request_id: string; p_reason: string; p_admin_id: string };
        Returns: Json;
      };
      revoke_analytics_approval: {
        Args: { p_request_id: string; p_reason: string; p_admin_id: string };
        Returns: Json;
      };
      assert_admin: {
        Args: { p_admin_id: string };
        Returns: undefined;
      };
      team_meets_stage_requirement: {
        Args: { p_round_id: string | null; p_team_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
