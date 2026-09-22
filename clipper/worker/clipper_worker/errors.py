"""Errores con mensaje pensado para mostrarse en la interfaz."""


class UserError(Exception):
    """Error esperable (link inválido, video privado, transcripción vacía...).

    El mensaje se guarda tal cual en la base y se muestra en la UI.
    """


class RetryableError(Exception):
    """Error transitorio: el trabajo vuelve a la cola."""
