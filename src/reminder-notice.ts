import { App, Modal } from 'obsidian';
import { t } from './i18n';
import { inheritDashboardThemeVars } from './theme-utils';

export class ReminderNoticeModal extends Modal {
	constructor(
		app: App,
		private taskText: string,
		private onDismiss: () => void,
		private onSnooze: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('dashboard-modal', 'dashboard-reminder-modal');
		inheritDashboardThemeVars(this.contentEl);
		this.contentEl.createDiv({ cls: 'dashboard-reminder-message', text: t('reminder.dueNotice', { task: this.taskText }) });
		const actions = this.contentEl.createDiv({ cls: 'dashboard-reminder-actions' });
		actions.createEl('button', { text: t('reminder.snooze') }).addEventListener('click', () => {
			this.onSnooze();
			this.close();
		});
		actions.createEl('button', { text: t('reminder.dismiss'), cls: 'mod-cta' }).addEventListener('click', () => {
			this.onDismiss();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
