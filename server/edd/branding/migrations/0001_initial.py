# -*- coding: utf-8 -*-
# Generated by Django 1.9.11 on 2017-03-03 18:29
# flake8: noqa

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [("sites", "0002_alter_domain_unique")]

    operations = [
        migrations.CreateModel(
            name="Branding",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("logo_name", models.TextField(default="EDD")),
                (
                    "logo_file",
                    models.ImageField(
                        default="/static/main/images/edd_letters.png",
                        null=True,
                        upload_to="",
                    ),
                ),
                (
                    "favicon_file",
                    models.ImageField(
                        default="/static/main/images/edd_letters.png",
                        null=True,
                        upload_to="",
                    ),
                ),
                ("style_sheet", models.FileField(null=True, upload_to="")),
            ],
        ),
        migrations.CreateModel(
            name="Page",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "branding",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="branding.Branding",
                    ),
                ),
                (
                    "site",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE, to="sites.Site"
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="branding",
            name="sites",
            field=models.ManyToManyField(through="branding.Page", to="sites.Site"),
        ),
    ]