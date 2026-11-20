<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * The email "Forgot your password?" sends: a link to the sign-in screen, ready to choose a new
 * password. Sent at once (no queue), through whatever MAIL_MAILER is set to; with the default,
 * "log", it is only written to the log.
 */
class ResetPasswordLink extends Notification
{
    public function __construct(public readonly string $url, public readonly int $minutes) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $site = (string) config('qbl.site_name', 'QuestLab');

        return (new MailMessage)
            ->subject("Choose a new password for {$site}")
            ->greeting('Hello '.($notifiable->name ?? 'there').',')
            ->line("Someone (we hope you) asked to choose a new password for the {$site} account that uses this address.")
            ->action('Choose a new password', $this->url)
            ->line("The link works once, for the next {$this->minutes} minutes.")
            ->line('If you did not ask for this, you can ignore this email: your password stays as it is.')
            ->salutation("— {$site}");
    }
}
