import { App, Modal } from 'obsidian';
import type { TrackerConfig, TrackerStyle } from './types';
import { suggestTrackerKeys } from './tracker-service';
import { t } from './i18n';
import { inheritDashboardThemeVars } from './theme-utils';

export class TrackerConfigModal extends Modal {
	private onSave: (title: string, config: TrackerConfig) => void;
	private theme: string;

	private keyValue = '';
	private daysValue = 30;
	private styleValue: TrackerStyle = 'line';

	constructor(
		app: App,
		onSave: (title: string, config: TrackerConfig) => void,
		theme?: string,
	) {
		super(app);
		this.onSave = onSave;
		this.theme = theme ?? 'earth';
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal');
		inheritDashboardThemeVars(contentEl);
		contentEl.createEl('h2', { text: t('tracker.configTitle') });

		const form = contentEl.createDiv({ cls: 'dashboard-modal-form' });

		// Frontmatter key input
		const keyField = form.createDiv({ cls: 'chart-config-field' });
		keyField.createEl('label', { text: t('tracker.keyLabel') });
		const keyInput = keyField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('tracker.keyPlaceholder') },
		});
		keyInput.addEventListener('input', () => {
			this.keyValue = keyInput.value.trim();
		});

		// Suggested keys
		const suggestions = suggestTrackerKeys(this.app);
		if (suggestions.length > 0) {
			const sugWrap = keyField.createDiv({ cls: 'tracker-key-suggestions' });
			sugWrap.createDiv({ cls: 'tracker-key-suggestions-label', text: t('tracker.keySuggestions') });
			const tagRow = sugWrap.createDiv({ cls: 'tracker-key-tags' });
			for (const k of suggestions.slice(0, 8)) {
				const tag = tagRow.createEl('button', { cls: 'tracker-key-tag', text: k });
				tag.addEventListener('click', () => {
					this.keyValue = k;
					keyInput.value = k;
				});
			}
		}

		// Chart style selector
		const styleField = form.createDiv({ cls: 'chart-config-field' });
		styleField.createEl('label', { text: t('tracker.styleLabel') });
		const styleRow = styleField.createDiv({ cls: 'chart-config-type-row' });

		const styleOptions: { value: TrackerStyle; label: string }[] = [
			{ value: 'line', label: t('tracker.styleLine') },
			{ value: 'heatmap', label: t('tracker.styleHeatmap') },
			{ value: 'bar', label: t('tracker.styleBar') },
		];

		for (const opt of styleOptions) {
			const btn = styleRow.createEl('button', {
				cls: 'chart-config-type-btn' + (opt.value === this.styleValue ? ' active' : ''),
				text: opt.label,
			});
			btn.addEventListener('click', () => {
				this.styleValue = opt.value;
				styleRow.querySelectorAll('.chart-config-type-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
			});
		}

		// Days selector
		const daysField = form.createDiv({ cls: 'chart-config-field' });
		daysField.createEl('label', { text: t('tracker.daysLabel') });
		const daysRow = daysField.createDiv({ cls: 'chart-config-type-row' });

		const dayOptions = [
			{ value: 7, label: t('tracker.days7') },
			{ value: 14, label: t('tracker.days14') },
			{ value: 30, label: t('tracker.days30') },
			{ value: 90, label: t('tracker.days90') },
			{ value: 180, label: t('tracker.days180') },
			{ value: 365, label: t('tracker.days365') },
		];

		for (const opt of dayOptions) {
			const btn = daysRow.createEl('button', {
				cls: 'chart-config-type-btn' + (opt.value === this.daysValue ? ' active' : ''),
				text: opt.label,
			});
			btn.addEventListener('click', () => {
				this.daysValue = opt.value;
				daysRow.querySelectorAll('.chart-config-type-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
			});
		}

		// Actions
		const actions = form.createDiv({ cls: 'dashboard-modal-actions' });
		const saveBtn = actions.createEl('button', { text: t('common.save'), cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => {
			if (!this.keyValue) return;
			this.onSave(this.keyValue, { key: this.keyValue, days: this.daysValue, style: this.styleValue });
			this.close();
		});

		const cancelBtn = actions.createEl('button', { text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());

		keyInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveBtn.click();
			}
		});

		keyInput.focus();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
