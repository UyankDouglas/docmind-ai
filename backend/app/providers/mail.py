"""Envio de e-mail (recuperação de senha, convites).

Sem `MAIL_HOST` configurado, o `ConsoleMailSender` registra o conteúdo no log do servidor — útil em
desenvolvimento e honesto: nada é enviado. Com SMTP configurado, usa `smtplib` com STARTTLS.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass(slots=True)
class Mail:
    to: str
    subject: str
    text: str


class MailSender(Protocol):
    name: str

    def send(self, mail: Mail) -> bool: ...


class ConsoleMailSender:
    name = "console"

    def __init__(self) -> None:
        self.sent: list[Mail] = []

    def send(self, mail: Mail) -> bool:
        self.sent.append(mail)
        # Em desenvolvimento o link precisa aparecer em algum lugar: o log do servidor.
        log.info("mail_console", to=mail.to, subject=mail.subject, body=mail.text)
        return True


class SMTPMailSender:
    name = "smtp"

    def send(self, mail: Mail) -> bool:
        msg = EmailMessage()
        msg["From"] = settings.mail_from
        msg["To"] = mail.to
        msg["Subject"] = mail.subject
        msg.set_content(mail.text)
        try:
            with smtplib.SMTP(settings.mail_host, settings.mail_port, timeout=15) as smtp:
                if settings.mail_use_tls:
                    smtp.starttls()
                if settings.mail_username:
                    smtp.login(settings.mail_username, settings.mail_password or "")
                smtp.send_message(msg)
            return True
        except Exception as exc:
            log.warning("mail_send_failed", error_type=type(exc).__name__)
            return False


_sender: MailSender | None = None


def get_mail_sender() -> MailSender:
    global _sender
    if _sender is None:
        _sender = SMTPMailSender() if settings.mail_host else ConsoleMailSender()
    return _sender


def set_mail_sender(sender: MailSender | None) -> None:
    global _sender
    _sender = sender
