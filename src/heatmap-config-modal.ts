import { App, Modal } from 'obsidian';
import type { HeatmapItem } from './types';
import { suggestTrackerKeys } from './tracker-service';
import { t } from './i18n';
import { inheritDashboardThemeVars } from './theme-utils';

export class HeatmapConfigModal extends Modal {
	private onSave: (item: HeatmapItem) => void;
	private theme: string;
	private existing: HeatmapItem | null;

	private keyValue = '';
	private labelValue = '';
	private daysValue = 30;

	constructor(
		app: App,
		onSave: (item: HeatmapItem) => void,
		existing?: HeatmapItem,
		theme?: string,
	) {
		super(app);
		this.onSave = onSave;
		this.existing = existing ?? null;
		this.theme = theme ?? 'default';
		if (existing) {
			this.keyValue = existing.key;
			this.labelValue = existing.label;
			this.daysValue = existing.days;
		}
	}

	onOpen(): void {
		const { contentEl, containerEl } = this;
		containerEl.dataset.theme = this.theme;
		contentEl.addClass('dashboard-modal');
		inheritDashboardThemeVars(contentEl);
		contentEl.createEl('h2', { text: t('heatmap.configTitle') });

		const form = contentEl.createDiv({ cls: 'dashboard-modal-form' });

		// Label input
		const labelField = form.createDiv({ cls: 'chart-config-field' });
		labelField.createEl('label', { text: t('heatmap.labelLabel') });
		const labelInput = labelField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('heatmap.labelPlaceholder') },
		});
		labelInput.value = this.labelValue;
		labelInput.addEventListener('input', () => {
			this.labelValue = labelInput.value.trim();
		});

		// Frontmatter key input
		const keyField = form.createDiv({ cls: 'chart-config-field' });
		keyField.createEl('label', { text: t('heatmap.keyLabel') });
		const keyInput = keyField.createEl('input', {
			cls: 'dashboard-modal-input',
			attr: { type: 'text', placeholder: t('heatmap.keyPlaceholder') },
		});
		keyInput.value = this.keyValue;
		keyInput.addEventListener('input', () => {
			this.keyValue = keyInput.value.trim();
		});

		// Suggested keys
		const suggestions = suggestTrackerKeys(this.app);
		if (suggestions.length > 0) {
			const sugWrap = keyField.createDiv({ cls: 'tracker-key-suggestions' });
			sugWrap.createDiv({ cls: 'tracker-key-suggestions-label', text: t('heatmap.keySuggestions') });
			const tagRow = sugWrap.createDiv({ cls: 'tracker-key-tags' });
			for (const k of suggestions.slice(0, 8)) {
				const tag = tagRow.createEl('button', { cls: 'tracker-key-tag', text: k });
				tag.addEventListener('click', () => {
					this.keyValue = k;
					keyInput.value = k;
					if (!labelInput.value.trim()) {
						this.labelValue = k;
						labelInput.value = k;
					}
				});
			}
		}

		// Days selector
		const daysField = form.createDiv({ cls: 'chart-config-field' });
		daysField.createEl('label', { text: t('heatmap.daysLabel') });
		const daysRow = daysField.createDiv({ cls: 'chart-config-type-row' });

		const dayOptions = [
			{ value: 30, label: '30 ' + t('countdown.days') },
			{ value: 90, label: '90 ' + t('countdown.days') },
			{ value: 180, label: '180 ' + t('countdown.days') },
			{ value: 365, label: '365 ' + t('countdown.days') },
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
			const label = this.labelValue || this.keyValue;
			this.onSave({
				id: this.existing?.id ?? `hm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
				key: this.keyValue,
				label,
				days: this.daysValue,
			});
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

		if (!this.existing) {
			labelInput.focus();
		} else {
			keyInput.focus();
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
