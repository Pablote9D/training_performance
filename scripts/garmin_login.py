#!/usr/bin/env python3
"""Inicia sesión en Garmin Connect una vez (con verificación en dos pasos si la
tenés) e imprime los tokens para guardarlos como secreto GARMINTOKENS en GitHub.

Uso:
    pip install garminconnect==0.3.20
    python scripts/garmin_login.py

Los tokens equivalen a tu sesión de Garmin: no los compartas ni los subas al repo.
"""
import getpass

from garminconnect import Garmin


def main() -> None:
    email = input("Email de Garmin: ").strip()
    password = getpass.getpass("Contraseña de Garmin: ")
    api = Garmin(email, password, prompt_mfa=lambda: input("Código de verificación: ").strip())
    api.login()
    print("\nLogin OK. Copiá TODO el texto de abajo en el secreto GARMINTOKENS:\n")
    print(api.client.dumps())


if __name__ == "__main__":
    main()
