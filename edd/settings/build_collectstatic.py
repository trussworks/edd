# -*- coding: utf-8 -*-
from .base import env, INSTALLED_APPS  # noqa: F401

# Minimal settings module to use Django's collectstatic command during Dockerfile build

# Load in values from environment
EDD_VERSION_HASH = env("EDD_VERSION_HASH", default="_")

# set DEBUG off so that the collectstatic command will hash files for the manifest
DEBUG = False

# must set some value in SECRET_KEY so that Django init can happen
SECRET_KEY = "temporary"

# must set default DATABASES key as well for Django init
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": "temporary",
    }
}

# TODO: code in EDD is written assuming these settings are always available
EDD_MAIN_SOLR = {}

# finally, the actual staticfiles settings:
# location where static assets are saved in Docker image
STATIC_ROOT = "/usr/local/edd-static"
# URL where static assets will eventually get served; used in processing references
STATIC_URL = "/static/"
# save the manifest specific to this build version
STATICFILES_MANIFEST = f"staticfiles.{EDD_VERSION_HASH}.json"
# use storage that uses the altered manifest name
STATICFILES_STORAGE = "edd.utilities.StaticFilesStorage"
