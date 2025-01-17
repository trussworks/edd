"""Views used as AJAX calls by the front-end Typescript code in EDD."""

import json
import logging

from django.contrib.postgres.aggregates import ArrayAgg
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.views import generic
from requests import codes

from edd import utilities

from .. import models as edd_models
from .. import query
from .study import StudyObjectMixin

logger = logging.getLogger(__name__)


def load_study(
    request, pk=None, slug=None, permission_type=edd_models.StudyPermission.CAN_VIEW
):
    """
    Loads a study as a request user; throws a 404 if the study does not exist OR if no valid
    permissions are set for the user on the study.

    :param request: the request loading the study
    :param pk: study's primary key; at least one of pk and slug must be provided
    :param slug: study's slug ID; at least one of pk and slug must be provided
    :param permission_type: required permission for the study access
    """
    permission = Q()
    if not request.user.is_superuser:
        permission = edd_models.Study.access_filter(
            request.user, access=permission_type
        )
    if pk is not None:
        return get_object_or_404(
            edd_models.Study.objects.distinct(), permission, Q(pk=pk)
        )
    elif slug is not None:
        return get_object_or_404(
            edd_models.Study.objects.distinct(), permission, Q(slug=slug)
        )
    raise Http404()


# /study/<study_id>/edddata/
def study_edddata(request, pk=None, slug=None):
    """
    Various information (both global and study-specific) that populates the
    EDDData JS object on the client. Deprecated, use REST APIs.
    """
    model = load_study(request, pk=pk, slug=slug)
    return JsonResponse(query.get_edddata_study(model), encoder=utilities.JSONEncoder)


# /study/<study_id>/assaydata/
def study_assay_table_data(request, pk=None, slug=None):
    """Request information on assays associated with a study."""
    model = load_study(request, pk=pk, slug=slug)
    active_param = request.GET.get("active", None)
    active_value = "true" == active_param if active_param in ("true", "false") else None
    active = edd_models.common.qfilter(value=active_value, fields=["active"])
    existingLines = model.line_set.filter(active)
    existingAssays = edd_models.Assay.objects.filter(active, line__study=model)
    return JsonResponse(
        {
            "ATData": {
                "existingLines": list(existingLines.values("name", "id")),
                "existingAssays": {
                    assays["protocol_id"]: assays["ids"]
                    for assays in existingAssays.values("protocol_id").annotate(
                        ids=ArrayAgg("id")
                    )
                },
            },
            "EDDData": query.get_edddata_study(model),
        },
        encoder=utilities.JSONEncoder,
    )


# /study/<study_id>/access/
def study_access(request, pk=None, slug=None):
    model = load_study(request, pk=pk, slug=slug)
    return JsonResponse(
        {
            "study": {"pk": model.pk, "slug": model.slug, "uuid": model.uuid},
            "urlAssay": reverse("rest:assays-list"),
            "urlCompartment": reverse("rest:compartments-list"),
            "urlLine": reverse("rest:lines-list"),
            "urlMeasurement": reverse("rest:measurements-list"),
            "urlMetadata": reverse("rest:metadata_types-list"),
            "urlProtocol": reverse("rest:protocols-list"),
            "urlType": reverse("rest:types-list"),
            "urlUnit": reverse("rest:units-list"),
            "urlUser": reverse("rest:users-list"),
        },
        encoder=utilities.JSONEncoder,
    )


class StudyPermissionJSONView(StudyObjectMixin, generic.detail.BaseDetailView):
    """Implements a REST-style view for /study/<id-or-slug>/permissions/"""

    def get(self, request, *args, **kwargs):
        instance = self.object = self.get_object()
        permissions = [
            permission.to_json() for permission in instance.get_combined_permission()
        ]
        return JsonResponse(permissions, safe=False)

    def head(self, request, *args, **kwargs):
        self.object = self.get_object()
        return HttpResponse(status=codes.ok)

    def post(self, request, *args, **kwargs):
        instance = self.object = self.get_object()
        self.check_write_permission(request)
        try:
            perms = json.loads(request.POST.get("data", "[]"))
            # make requested changes as a group, or not at all
            with transaction.atomic():
                success = all(
                    self._handle_permission_update(permission_def)
                    for permission_def in perms
                )
                if not success:
                    raise PermissionDenied()
        except PermissionDenied:
            raise
        except Exception as e:
            logger.exception(f"Error modifying study ({instance}) permissions: {e}")
            return HttpResponse(status=codes.bad_request)
        return HttpResponse(status=codes.no_content)

    # Treat PUT requests the same as POST
    put = post

    def delete(self, request, *args, **kwargs):
        instance = self.object = self.get_object()
        self.check_write_permission(request)
        try:
            # make requested changes as a group, or not at all
            with transaction.atomic():
                instance.everyonepermission_set.all().delete()
                instance.grouppermission_set.all().delete()
                instance.userpermission_set.all().delete()
        except Exception as e:
            logger.exception(f"Error deleting study ({instance}) permissions: {e}")
            return HttpResponse(status=codes.bad_request)
        return HttpResponse(status=codes.no_content)

    def _handle_permission_update(self, permission_def):
        # update a permission based on input dict from JSON
        # return False when nothing updated, otherwise True
        instance = self.get_object()
        ptype = permission_def.get("type", None)
        kwargs = dict(study=instance)
        defaults = dict(permission_type=ptype)
        manager = None
        if "group" in permission_def:
            kwargs.update(group_id=permission_def["group"].get("id", 0))
            manager = instance.grouppermission_set
        elif "user" in permission_def:
            kwargs.update(user_id=permission_def["user"].get("id", 0))
            manager = instance.userpermission_set
        elif "public" in permission_def:
            if edd_models.EveryonePermission.can_make_public(self.request.user):
                manager = instance.everyonepermission_set

        if manager is None or ptype is None:
            logger.info(f"Refusing to set permission {permission_def}")
            return False
        elif ptype == edd_models.StudyPermission.NONE:
            manager.filter(**kwargs).delete()
            return True
        else:
            kwargs.update(defaults=defaults)
            manager.update_or_create(**kwargs)
            return True
