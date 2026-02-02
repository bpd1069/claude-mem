import React, { useState, useCallback, useEffect } from 'react';
import type { Settings } from '../types';
import { TerminalPreview } from './TerminalPreview';
import { useContextPreview } from '../hooks/useContextPreview';

interface ContextSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
  isSaving: boolean;
  saveStatus: string;
}

// Collapsible section component
function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = true
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`settings-section-collapsible ${isOpen ? 'open' : ''}`}>
      <button
        className="section-header-btn"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="section-header-content">
          <span className="section-title">{title}</span>
          {description && <span className="section-description">{description}</span>}
        </div>
        <svg
          className={`chevron-icon ${isOpen ? 'rotated' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && <div className="section-content">{children}</div>}
    </div>
  );
}

// Chip group with select all/none
function ChipGroup({
  label,
  options,
  selectedValues,
  onToggle,
  onSelectAll,
  onSelectNone
}: {
  label: string;
  options: string[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  const allSelected = options.every(opt => selectedValues.includes(opt));
  const noneSelected = options.every(opt => !selectedValues.includes(opt));

  return (
    <div className="chip-group">
      <div className="chip-group-header">
        <span className="chip-group-label">{label}</span>
        <div className="chip-group-actions">
          <button
            type="button"
            className={`chip-action ${allSelected ? 'active' : ''}`}
            onClick={onSelectAll}
          >
            All
          </button>
          <button
            type="button"
            className={`chip-action ${noneSelected ? 'active' : ''}`}
            onClick={onSelectNone}
          >
            None
          </button>
        </div>
      </div>
      <div className="chips-container">
        {options.map(option => (
          <button
            key={option}
            type="button"
            className={`chip ${selectedValues.includes(option) ? 'selected' : ''}`}
            onClick={() => onToggle(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

// Form field with optional tooltip
function FormField({
  label,
  tooltip,
  children
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-field">
      <label className="form-field-label">
        {label}
        {tooltip && (
          <span className="tooltip-trigger" title={tooltip}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

// Toggle switch component
function ToggleSwitch({
  id,
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-info">
        <label htmlFor={id} className="toggle-label">{label}</label>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        className={`toggle-switch ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

export function ContextSettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  isSaving,
  saveStatus
}: ContextSettingsModalProps) {
  const [formState, setFormState] = useState<Settings>(settings);

  // Update form state when settings prop changes
  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  // Get context preview based on current form state
  const { preview, isLoading, error, projects, selectedProject, setSelectedProject } = useContextPreview(formState);

  const updateSetting = useCallback((key: keyof Settings, value: string) => {
    const newState = { ...formState, [key]: value };
    setFormState(newState);
  }, [formState]);

  const handleSave = useCallback(() => {
    onSave(formState);
  }, [formState, onSave]);

  const toggleBoolean = useCallback((key: keyof Settings) => {
    const currentValue = formState[key];
    const newValue = currentValue === 'true' ? 'false' : 'true';
    updateSetting(key, newValue);
  }, [formState, updateSetting]);

  const toggleArrayValue = useCallback((key: keyof Settings, value: string) => {
    const currentValue = formState[key] || '';
    const currentArray = currentValue ? currentValue.split(',') : [];
    const newArray = currentArray.includes(value)
      ? currentArray.filter(v => v !== value)
      : [...currentArray, value];
    updateSetting(key, newArray.join(','));
  }, [formState, updateSetting]);

  const getArrayValues = useCallback((key: keyof Settings): string[] => {
    const currentValue = formState[key] || '';
    return currentValue ? currentValue.split(',') : [];
  }, [formState]);

  const setAllArrayValues = useCallback((key: keyof Settings, values: string[]) => {
    updateSetting(key, values.join(','));
  }, [updateSetting]);

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const observationTypes = ['bugfix', 'feature', 'refactor', 'discovery', 'decision', 'change'];
  const observationConcepts = ['how-it-works', 'why-it-exists', 'what-changed', 'problem-solution', 'gotcha', 'pattern', 'trade-off'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="context-settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2>Settings</h2>
          <div className="header-controls">
            <label className="preview-selector">
              Preview for:
              <select
                value={selectedProject || ''}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                {projects.map(project => (
                  <option key={project} value={project}>{project}</option>
                ))}
              </select>
            </label>
            <button
              onClick={onClose}
              className="modal-close-btn"
              title="Close (Esc)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body - 2 columns */}
        <div className="modal-body">
          {/* Left column - Terminal Preview */}
          <div className="preview-column">
            <div className="preview-content">
              {error ? (
                <div style={{ color: '#ff6b6b' }}>
                  Error loading preview: {error}
                </div>
              ) : (
                <TerminalPreview content={preview} isLoading={isLoading} />
              )}
            </div>
          </div>

          {/* Right column - Settings Panel */}
          <div className="settings-column">
            {/* Section 1: Loading */}
            <CollapsibleSection
              title="Loading"
              description="How many observations to inject"
            >
              <FormField
                label="Observations"
                tooltip="Number of recent observations to include in context (1-200)"
              >
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={formState.CLAUDE_MEM_CONTEXT_OBSERVATIONS || '50'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_OBSERVATIONS', e.target.value)}
                />
              </FormField>
              <FormField
                label="Sessions"
                tooltip="Number of recent sessions to pull observations from (1-50)"
              >
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={formState.CLAUDE_MEM_CONTEXT_SESSION_COUNT || '10'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_SESSION_COUNT', e.target.value)}
                />
              </FormField>
            </CollapsibleSection>

            {/* Section 2: Filters */}
            <CollapsibleSection
              title="Filters"
              description="Which observation types to include"
            >
              <ChipGroup
                label="Type"
                options={observationTypes}
                selectedValues={getArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES')}
                onToggle={(value) => toggleArrayValue('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES', value)}
                onSelectAll={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES', observationTypes)}
                onSelectNone={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES', [])}
              />
              <ChipGroup
                label="Concept"
                options={observationConcepts}
                selectedValues={getArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS')}
                onToggle={(value) => toggleArrayValue('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS', value)}
                onSelectAll={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS', observationConcepts)}
                onSelectNone={() => setAllArrayValues('CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS', [])}
              />
            </CollapsibleSection>

            {/* Section 3: Display */}
            <CollapsibleSection
              title="Display"
              description="What to show in context tables"
            >
              <div className="display-subsection">
                <span className="subsection-label">Full Observations</span>
                <FormField
                  label="Count"
                  tooltip="How many observations show expanded details (0-20)"
                >
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={formState.CLAUDE_MEM_CONTEXT_FULL_COUNT || '5'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_FULL_COUNT', e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Field"
                  tooltip="Which field to expand for full observations"
                >
                  <select
                    value={formState.CLAUDE_MEM_CONTEXT_FULL_FIELD || 'narrative'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_FULL_FIELD', e.target.value)}
                  >
                    <option value="narrative">Narrative</option>
                    <option value="facts">Facts</option>
                  </select>
                </FormField>
              </div>

              <div className="display-subsection">
                <span className="subsection-label">Token Economics</span>
                <div className="toggle-group">
                  <ToggleSwitch
                    id="show-read-tokens"
                    label="Read cost"
                    description="Tokens to read this observation"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS')}
                  />
                  <ToggleSwitch
                    id="show-work-tokens"
                    label="Work investment"
                    description="Tokens spent creating this observation"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS')}
                  />
                  <ToggleSwitch
                    id="show-savings-amount"
                    label="Savings"
                    description="Total tokens saved by reusing context"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT')}
                  />
                </div>
              </div>
            </CollapsibleSection>

            {/* Section 4: Advanced */}
            <CollapsibleSection
              title="Advanced"
              description="AI provider and model selection"
              defaultOpen={false}
            >
              <FormField
                label="AI Provider"
                tooltip="Choose between Claude (via Agent SDK) or Gemini (via REST API)"
              >
                <select
                  value={formState.CLAUDE_MEM_PROVIDER || 'claude'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_PROVIDER', e.target.value)}
                >
                  <option value="claude">Claude (uses your Claude account)</option>
                  <option value="gemini">Gemini (uses API key)</option>
                  <option value="openrouter">OpenRouter (multi-model)</option>
                  <option value="lmstudio">LM Studio (local models)</option>
                </select>
              </FormField>

              {formState.CLAUDE_MEM_PROVIDER === 'claude' && (
                <FormField
                  label="Claude Model"
                  tooltip="Claude model used for generating observations"
                >
                  <select
                    value={formState.CLAUDE_MEM_MODEL || 'haiku'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_MODEL', e.target.value)}
                  >
                    <option value="haiku">haiku (fastest)</option>
                    <option value="sonnet">sonnet (balanced)</option>
                    <option value="opus">opus (highest quality)</option>
                  </select>
                </FormField>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'gemini' && (
                <>
                  <FormField
                    label="Gemini API Key"
                    tooltip="Your Google AI Studio API key (or set GEMINI_API_KEY env var)"
                  >
                    <input
                      type="password"
                      value={formState.CLAUDE_MEM_GEMINI_API_KEY || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_API_KEY', e.target.value)}
                      placeholder="Enter Gemini API key..."
                    />
                  </FormField>
                  <FormField
                    label="Gemini Model"
                    tooltip="Gemini model used for generating observations"
                  >
                    <select
                      value={formState.CLAUDE_MEM_GEMINI_MODEL || 'gemini-2.5-flash-lite'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_MODEL', e.target.value)}
                    >
                      <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (10 RPM free)</option>
                      <option value="gemini-2.5-flash">gemini-2.5-flash (5 RPM free)</option>
                      <option value="gemini-3-flash">gemini-3-flash (5 RPM free)</option>
                    </select>
                  </FormField>
                  <div className="toggle-group" style={{ marginTop: '8px' }}>
                    <ToggleSwitch
                      id="gemini-rate-limiting"
                      label="Rate Limiting"
                      description="Enable for free tier (10-30 RPM). Disable if you have billing set up (1000+ RPM)."
                      checked={formState.CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED === 'true'}
                      onChange={(checked) => updateSetting('CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED', checked ? 'true' : 'false')}
                    />
                  </div>
                </>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'openrouter' && (
                <>
                  <FormField
                    label="OpenRouter API Key"
                    tooltip="Your OpenRouter API key from openrouter.ai (or set OPENROUTER_API_KEY env var)"
                  >
                    <input
                      type="password"
                      value={formState.CLAUDE_MEM_OPENROUTER_API_KEY || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_API_KEY', e.target.value)}
                      placeholder="Enter OpenRouter API key..."
                    />
                  </FormField>
                  <FormField
                    label="OpenRouter Model"
                    tooltip="Model identifier from OpenRouter (e.g., anthropic/claude-3.5-sonnet, google/gemini-2.0-flash-thinking-exp)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_MODEL || 'xiaomi/mimo-v2-flash:free'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_MODEL', e.target.value)}
                      placeholder="e.g., xiaomi/mimo-v2-flash:free"
                    />
                  </FormField>
                  <FormField
                    label="Site URL (Optional)"
                    tooltip="Your site URL for OpenRouter analytics (optional)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_SITE_URL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_SITE_URL', e.target.value)}
                      placeholder="https://yoursite.com"
                    />
                  </FormField>
                  <FormField
                    label="App Name (Optional)"
                    tooltip="Your app name for OpenRouter analytics (optional)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_APP_NAME || 'claude-mem'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_APP_NAME', e.target.value)}
                      placeholder="claude-mem"
                    />
                  </FormField>
                </>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'lmstudio' && (
                <>
                  <FormField
                    label="LM Studio URL"
                    tooltip="LM Studio server URL (default: http://localhost:1234/v1)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_LMSTUDIO_BASE_URL || 'http://localhost:1234/v1'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_LMSTUDIO_BASE_URL', e.target.value)}
                      placeholder="http://localhost:1234/v1"
                    />
                  </FormField>
                  <FormField
                    label="Model"
                    tooltip="Model name loaded in LM Studio (leave empty for default). Recommended: ibm/granite-4-h-tiny"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_LMSTUDIO_MODEL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_LMSTUDIO_MODEL', e.target.value)}
                      placeholder="e.g., ibm/granite-4-h-tiny"
                    />
                  </FormField>
                </>
              )}

              <FormField
                label="Worker Port"
                tooltip="Port for the background worker service"
              >
                <input
                  type="number"
                  min="1024"
                  max="65535"
                  value={formState.CLAUDE_MEM_WORKER_PORT || '37777'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_WORKER_PORT', e.target.value)}
                />
              </FormField>

              <div className="toggle-group" style={{ marginTop: '12px' }}>
                <ToggleSwitch
                  id="show-last-summary"
                  label="Include last summary"
                  description="Add previous session's summary to context"
                  checked={formState.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY === 'true'}
                  onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY')}
                />
                <ToggleSwitch
                  id="show-last-message"
                  label="Include last message"
                  description="Add previous session's final message"
                  checked={formState.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE === 'true'}
                  onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE')}
                />
              </div>
            </CollapsibleSection>

            {/* Section 5: Federation */}
            <CollapsibleSection
              title="Federation"
              description="Connect to remote memory databases"
              defaultOpen={false}
            >
              <div className="federation-diagram">
                <pre style={{ fontSize: '10px', lineHeight: '1.2', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
{`    Local (1.0)
       /|\\
      / | \\
     /  |  \\
R1 ─/───┼───\\─ R2
(.618)  |  (.382)
        R3
      (.236)`}
                </pre>
              </div>
              <FormField
                label="Max Remotes"
                tooltip="Maximum remote databases (tetrahedron: 3 max)"
              >
                <input
                  type="number"
                  min="0"
                  max="3"
                  value={formState.FEDERATION_MAX_REMOTES || '3'}
                  onChange={(e) => updateSetting('FEDERATION_MAX_REMOTES', e.target.value)}
                />
              </FormField>
              <FormField
                label="Priority Decay"
                tooltip="How to weight results from remote databases"
              >
                <select
                  value={formState.FEDERATION_PRIORITY_DECAY || 'golden'}
                  onChange={(e) => updateSetting('FEDERATION_PRIORITY_DECAY', e.target.value)}
                >
                  <option value="golden">Golden Ratio (φ⁻ⁿ)</option>
                  <option value="exponential">Exponential (0.5ⁿ)</option>
                  <option value="linear">Linear (1 - 0.25n)</option>
                </select>
              </FormField>
              <FormField
                label="Query Timeout (ms)"
                tooltip="Timeout per remote database query"
              >
                <input
                  type="number"
                  min="1000"
                  max="30000"
                  step="1000"
                  value={formState.FEDERATION_QUERY_TIMEOUT_MS || '5000'}
                  onChange={(e) => updateSetting('FEDERATION_QUERY_TIMEOUT_MS', e.target.value)}
                />
              </FormField>
              <FormField
                label="Total Timeout (ms)"
                tooltip="Total budget across all remote queries"
              >
                <input
                  type="number"
                  min="5000"
                  max="60000"
                  step="1000"
                  value={formState.FEDERATION_TOTAL_TIMEOUT_MS || '15000'}
                  onChange={(e) => updateSetting('FEDERATION_TOTAL_TIMEOUT_MS', e.target.value)}
                />
              </FormField>
              <FormField
                label="Allow List"
                tooltip="Comma-separated allowed remote URLs (empty = allow all)"
              >
                <input
                  type="text"
                  value={formState.FEDERATION_ALLOW_LIST || ''}
                  onChange={(e) => updateSetting('FEDERATION_ALLOW_LIST', e.target.value)}
                  placeholder="https://memory.team.com, ..."
                />
              </FormField>
              <div className="toggle-group" style={{ marginTop: '8px' }}>
                <ToggleSwitch
                  id="federation-read-only"
                  label="Read-only remotes"
                  description="Remotes are read-only (recommended for security)"
                  checked={formState.FEDERATION_READ_ONLY !== 'false'}
                  onChange={(checked) => updateSetting('FEDERATION_READ_ONLY', checked ? 'true' : 'false')}
                />
              </div>
            </CollapsibleSection>

            {/* Section 6: Migration */}
            <CollapsibleSection
              title="Migration"
              description="Import data from external databases"
              defaultOpen={false}
            >
              <div className="migration-info" style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.4' }}>
                Import observations from external sources with different schemas.
                Configure field mappings to transform external data to internal format.
              </div>
              <FormField
                label="Source URL"
                tooltip="URL of the external database to import from"
              >
                <input
                  type="text"
                  value={formState.MIGRATION_SOURCE_URL || ''}
                  onChange={(e) => updateSetting('MIGRATION_SOURCE_URL', e.target.value)}
                  placeholder="https://team-memory.example.com/api"
                />
              </FormField>
              <FormField
                label="Source Name"
                tooltip="Identifier for this import source"
              >
                <input
                  type="text"
                  value={formState.MIGRATION_SOURCE_NAME || ''}
                  onChange={(e) => updateSetting('MIGRATION_SOURCE_NAME', e.target.value)}
                  placeholder="team-memory"
                />
              </FormField>
              <FormField
                label="Target Project"
                tooltip="Project name to assign to imported observations"
              >
                <input
                  type="text"
                  value={formState.MIGRATION_TARGET_PROJECT || ''}
                  onChange={(e) => updateSetting('MIGRATION_TARGET_PROJECT', e.target.value)}
                  placeholder="imported-data"
                />
              </FormField>

              <div className="display-subsection" style={{ marginTop: '12px' }}>
                <span className="subsection-label">Field Mappings</span>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                  Map external field names to internal schema. Use dot notation for nested fields (e.g., data.info.title)
                </div>
                <FormField label="ID Field" tooltip="External field name for observation ID">
                  <input
                    type="text"
                    value={formState.MIGRATION_FIELD_ID || 'id'}
                    onChange={(e) => updateSetting('MIGRATION_FIELD_ID', e.target.value)}
                    placeholder="id"
                  />
                </FormField>
                <FormField label="Title Field" tooltip="External field name for title">
                  <input
                    type="text"
                    value={formState.MIGRATION_FIELD_TITLE || 'title'}
                    onChange={(e) => updateSetting('MIGRATION_FIELD_TITLE', e.target.value)}
                    placeholder="title"
                  />
                </FormField>
                <FormField label="Narrative Field" tooltip="External field name for narrative/content">
                  <input
                    type="text"
                    value={formState.MIGRATION_FIELD_NARRATIVE || 'narrative'}
                    onChange={(e) => updateSetting('MIGRATION_FIELD_NARRATIVE', e.target.value)}
                    placeholder="narrative or content"
                  />
                </FormField>
                <FormField label="Type Field" tooltip="External field name for observation type">
                  <input
                    type="text"
                    value={formState.MIGRATION_FIELD_TYPE || 'type'}
                    onChange={(e) => updateSetting('MIGRATION_FIELD_TYPE', e.target.value)}
                    placeholder="type or category"
                  />
                </FormField>
                <FormField label="Timestamp Field" tooltip="External field name for timestamp">
                  <input
                    type="text"
                    value={formState.MIGRATION_FIELD_TIMESTAMP || 'created_at_epoch'}
                    onChange={(e) => updateSetting('MIGRATION_FIELD_TIMESTAMP', e.target.value)}
                    placeholder="created_at_epoch or timestamp"
                  />
                </FormField>
              </div>

              <div className="display-subsection" style={{ marginTop: '12px' }}>
                <span className="subsection-label">Transforms</span>
                <FormField label="Timestamp Format" tooltip="How timestamps are encoded in source">
                  <select
                    value={formState.MIGRATION_TIMESTAMP_FORMAT || 'epoch_ms'}
                    onChange={(e) => updateSetting('MIGRATION_TIMESTAMP_FORMAT', e.target.value)}
                  >
                    <option value="epoch_ms">Epoch Milliseconds</option>
                    <option value="epoch_s">Epoch Seconds</option>
                    <option value="iso8601">ISO 8601 String</option>
                  </select>
                </FormField>
              </div>

              <div className="toggle-group" style={{ marginTop: '12px' }}>
                <ToggleSwitch
                  id="migration-dry-run"
                  label="Dry Run"
                  description="Validate without importing (preview mode)"
                  checked={formState.MIGRATION_DRY_RUN === 'true'}
                  onChange={(checked) => updateSetting('MIGRATION_DRY_RUN', checked ? 'true' : 'false')}
                />
              </div>

              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                  Save settings first, then use CLI to run migration:
                </div>
                <pre style={{ fontSize: '10px', background: 'var(--bg-secondary)', padding: '8px', borderRadius: '4px', overflow: 'auto' }}>
{`bun claude-mem migrate \\
  --source "$MIGRATION_SOURCE_URL" \\
  --project "$MIGRATION_TARGET_PROJECT"`}
                </pre>
              </div>
            </CollapsibleSection>
          </div>
        </div>

        {/* Footer with Save button */}
        <div className="modal-footer">
          <div className="save-status">
            {saveStatus && <span className={saveStatus.includes('✓') ? 'success' : saveStatus.includes('✗') ? 'error' : ''}>{saveStatus}</span>}
          </div>
          <button
            className="save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
