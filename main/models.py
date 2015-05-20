import arrow
import edd.settings
import os.path
import re
from collections import defaultdict
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ObjectDoesNotExist
from django.db import models
from django_extensions.db.fields import PostgreSQLUUIDField
from django_hstore import hstore
from itertools import chain
from threadlocals.threadlocals import get_current_request


class Update(models.Model):
    """
    A user update; referenced from other models that track creation and/or modification.

    Views get an Update object by calling main.models.Update.load_request_update(request) to
    lazy-load a request-scoped Update object model.
    """
    class Meta:
        db_table = 'update_info'
    mod_time = models.DateTimeField(auto_now_add=True, editable=False)
    mod_by = models.ForeignKey(settings.AUTH_USER_MODEL, editable=False, null=True)
    path = models.TextField(blank=True, null=True)
    origin = models.TextField(blank=True, null=True)

    def __str__(self):
        try:
            time = arrow.get(self.mod_time).humanize()
        except Exception as e:
            time = self.mod_time
        return '%s by %s' % (time, self.mod_by)

    @classmethod
    def load_update(cls):
        request = get_current_request()
        if request is None:
            update = cls(mod_time=arrow.utcnow(),
                         mod_by=None,
                         path=None,
                         origin='localhost')
            update.save()
        else:
            update = cls.load_request_update(request)
        return update

    @classmethod
    def load_request_update(cls, request):
        rhost = '%s; %s' % (
            request.META.get('REMOTE_ADDR', None),
            request.META.get('REMOTE_HOST', ''))
        if not hasattr(request, 'update_key'):
            update = cls(mod_time=arrow.utcnow(),
                         mod_by=request.user,
                         path=request.get_full_path(),
                         origin=rhost)
            update.save()
            request.update_key = update.pk
        else:
            update = cls.objects.get(pk=request.update_key)
        return update

    @property
    def initials(self):
        if self.mod_by_id is None:
            return None
        return self.mod_by.initials

    @property
    def full_name(self):
        if self.mod_by_id is None:
            return None
        return ' '.join([self.mod_by.first_name, self.mod_by.last_name, ])

    @property
    def email(self):
        if self.mod_by_id is None:
            return None
        return self.mod_by.email

    def to_json(self):
        return {
            "time": arrow.get(self.mod_time).timestamp,
            "user": self.mod_by_id,
        }

    def format_timestamp (self, format_string="%b %d %Y %I:%M%p") :
        """
        Convert the datetime (mod_time) to a human-readable string, including
        conversion from UTC to local time zone.
        """
        return arrow.get(self.mod_time).to('local').strftime(format_string)


class Comment(models.Model):
    """
    """
    class Meta:
        db_table = 'comment'
    object_ref = models.ForeignKey('EDDObject', related_name='comments')
    body = models.TextField()
    created = models.ForeignKey(Update, related_name='+')


class Attachment(models.Model):
    """
    """
    class Meta:
        db_table = 'attachment'
    object_ref = models.ForeignKey('EDDObject', related_name='files')
    file = models.FileField(max_length=255)
    filename = models.CharField(max_length=255)
    created = models.ForeignKey(Update, related_name='+')
    description = models.TextField(blank=True, null=False)
    mime_type = models.CharField(max_length=255, null=True)
    file_size = models.IntegerField(default=0)

    @classmethod
    def from_upload (cls, edd_object, form, uploaded_file, update) :
        return cls.objects.create(
            object_ref=edd_object,
            file=uploaded_file,
            filename=uploaded_file.name,
            created=update,
            description=form.get("newAttachmentDescription"),
            mime_type=uploaded_file.content_type,
            file_size=len(uploaded_file.read()))

    @property
    def user_initials (self) :
        return self.created.initials

    @property
    def icon (self) :
        from main.utilities import extensions_to_icons
        base, ext = os.path.splitext(self.filename)
        return extensions_to_icons.get(ext, "icon-generic.png")

    # TODO can we make this more general?
    def user_can_delete (self, user) :
        """
        Verify that a user has the appropriate permissions to delete an
        attachment.  This only applies to files attached to a Study.
        """
        if (self.object_ref.__class__ is Study) :
            return self.object_ref.user_can_write(user)
        else :
            return user.is_staff

    # TODO can we make this more general?
    def user_can_read (self, user) :
        """
        Verify that a user has the appropriate permissions to see (that is,
        download) an attachment.  This only applies to files attached to a
        Study.
        """
        if (self.object_ref.__class__ is Study) :
            return self.object_ref.user_can_read(user)
        return True # XXX is this wise?


class MetadataGroup(models.Model):
    """
    """
    class Meta:
        db_table = 'metadata_group'
    group_name = models.CharField(max_length=255, unique=True)

    def __str__(self):
        return self.group_name


class MetadataType(models.Model):
    """
    """
    STUDY = 'S'
    LINE = 'L'
    PROTOCOL = 'P'
    LINE_OR_PROTOCOL = 'LP'
    ALL = 'LPS'
    CONTEXT_SET = (
        (STUDY, 'Study'),
        (LINE, 'Line'),
        (PROTOCOL, 'Protocol'),
        (LINE_OR_PROTOCOL, 'Line or Protocol'),
        (ALL, 'All'),
    )
    class Meta:
        db_table = 'metadata_type'
    group = models.ForeignKey(MetadataGroup)
    type_name = models.CharField(max_length=255, unique=True)
    type_i18n = models.CharField(max_length=255, blank=True, null=True)
    input_size = models.IntegerField(default=6)
    default_value = models.CharField(max_length=255, blank=True)
    prefix = models.CharField(max_length=255, blank=True)
    postfix = models.CharField(max_length=255, blank=True)
    for_context = models.CharField(max_length=8, choices=CONTEXT_SET)
    # TODO: add a type_class field and utility method to take a Metadata.data_value and return
    #   a model instance; e.g. type_class = 'CarbonSource' would do a
    #   CarbonSource.objects.get(pk=value)
    type_class = models.CharField(max_length=255, blank=True, null=True)

    def for_line(self):
        return (self.for_context == self.LINE or
            self.for_context == self.LINE_OR_PROTOCOL or
            self.for_context == self.ALL)

    def for_protocol(self):
        return (self.for_context == self.PROTOCOL or
            self.for_context == self.LINE_OR_PROTOCOL or
            self.for_context == self.ALL)

    def for_study(self):
        return (self.for_context == self.STUDY or
            self.for_context == self.ALL)

    def __str__(self):
        return self.type_name

    def to_json (self) :
        return {
            "id" : self.pk,
            "gn" : self.group.group_name,
            "gid" : self.group.id,
            "name" : self.type_name,
            "is" : self.input_size,
            "pre" : self.prefix,
            "postfix" : self.postfix,
            "default" : self.default_value,
            "ll" : self.for_line(),
            "pl" : self.for_protocol(),
            "context" : self.for_context,
        }

    @classmethod
    def all_with_groups (cls) :
        return cls.objects.all().extra(
            select={'lower_name':'lower(type_name)'}).order_by(
                "lower_name").select_related("group")

    def is_allowed_object (self, obj) :
        """
        Indicate whether this metadata type can be associated with the given
        object based on the for_context attribute.
        """
        if (obj.__class__ is Study) : return self.for_study()
        elif (obj.__class__ is Line) : return self.for_line()
        elif (obj.__class__ is Protocol) : return self.for_protocol()
        elif (obj.__class__ is Assay) : return self.for_protocol()
        else : return (self.for_context == self.ALL)


class EDDObject(models.Model):
    """
    A first-class EDD object, with update trail, comments, attachments.
    """
    class Meta:
        db_table = 'edd_object'
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    updates = models.ManyToManyField(Update, db_table='edd_object_update', related_name='+')
    # these are used often enough we should save extra queries by including as fields
    created = models.ForeignKey(Update, related_name='+', editable=False)
    updated = models.ForeignKey(Update, related_name='+', editable=False)
    # store arbitrary metadata as a dict with hstore extension
    meta_store = hstore.DictionaryField(blank=True, default=dict)

    # Use custom hstore manager to enable queries on hstore data
    objects = hstore.HStoreManager()

    @property
    def mod_epoch (self) :
        return arrow.get(self.updated.mod_time).timestamp

    # FIXME is this needed with updated now a field?
    @property
    def last_modified (self) :
        return self.updated.format_timestamp()

    def was_modified (self) :
        return self.updates.count() > 1

    # FIXME is this needed with created now a field?
    @property
    def date_created (self) :
        return self.created.format_timestamp()

    def get_attachment_count(self):
        return self.files.count()

    @property
    def attachments (self) :
        return self.files.all()

    def get_comment_count(self):
        return self.comments.count()

    def get_metadata_json(self):
        return self.meta_store

    def get_metadata_types(self):
        return list(MetadataType.objects.filter(pk__in=self.meta_store.keys()))

    @classmethod
    def metadata_type_frequencies (cls) :
        freqs = defaultdict(int)
        for obj in cls.objects.all() :
            mdtype_keys = obj.meta_store.keys()
            for mdtype_id in mdtype_keys :
                freqs[int(mdtype_id)] += 1
        return freqs

    def get_metadata_item (self, key=None, pk=None) :
        assert ([pk, key].count(None) == 1)
        if (pk is None) :
            pk = MetadataType.objects.get(type_name=key)
        return self.meta_store.get(str(pk.id))

    def get_metadata_dict (self) :
        """
        Return a Python dictionary of metadata with the keys replaced by the
        string representations of the corresponding MetadataType records.
        """
        metadata_types = { str(mt.id):mt for mt in self.get_metadata_types() }
        metadata = {}
        for pk, value in self.meta_store.iteritems() :
            metadata_type = metadata_types[pk]
            if metadata_type.prefix :
                value = metadata_type.prefix + " " + value
            if metadata_type.postfix :
                value = value + " " + metadata_type.postfix
            metadata[str(metadata_types[pk])] = value
        return metadata

    def set_metadata_item (self, key, value, defer_save=False) :
        mdtype = MetadataType.objects.get(type_name=key)
        if (not mdtype.is_allowed_object(self)) :
            raise ValueError(("The metadata type '%s' does not apply to "+
                "%s objects.") % (mdtype.type_name, self.__class__.__name__))
        self.meta_store[str(mdtype.id)] = value
        if (not defer_save) :
            self.save()

    def __str__(self):
        return self.name

    # http://stackoverflow.com/questions/3409047
    @classmethod
    def all_sorted_by_name (cls) :
        """
        Returns a query set sorted by the name field in case-insensitive order.
        """
        return cls.objects.all().extra(
            select={'lower_name':'lower(name)'}).order_by('lower_name')

    def update_name_from_form (self, form, key) :
        """
        Set the 'name' field from a posted form, with error checking.
        """
        name = form.get(key, "").strip()
        if (name == "") :
            raise ValueError("%s name must not be blank." %
                self.__class__.__name__)
        self.name = name

    def save(self, *args, **kwargs):
        if self.created_id is None:
            self.created = Update.load_update()
        if self.updated_id is None:
            self.updated = Update.load_update()
        super(EDDObject, self).save(*args, **kwargs)


class Study(EDDObject):
    """
    A collection of items to be studied.
    """
    class Meta:
        db_table = 'study'
        verbose_name_plural = 'Studies'
    active = models.BooleanField(default=True)
    object_ref = models.OneToOneField(EDDObject, parent_link=True)
    # contact info has two fields to support:
    # 1. linking to a specific user in EDD
    # 2. "This is data I got from 'Improving unobtanium production in Bio-Widget using foobar'
    #    published in Feb 2016 Bio-Widget Journal, paper has hpotter@hogwarts.edu as contact"
    contact = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True,
                                related_name='contact_study_set')
    contact_extra = models.TextField()

    def to_solr_json(self):
        """
        Convert the Study model to a dict structure formatted for Solr JSON.
        """
        created = self.created
        updated = self.updated
        return {
            'id': self.pk,
            'name': self.name,
            'description': self.description,
            'creator': created.mod_by_id,
            'creator_email': created.email,
            'creator_name': created.full_name,
            'initials': created.initials,
            'contact': self.get_contact(),
            'active': self.active,
            'created': created.mod_time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'modified': updated.mod_time.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'attachment_count': self.get_attachment_count(),
            'comment_count': self.get_comment_count(),
            'metabolite': [m.to_solr_value() for m in self.get_metabolite_types_used()],
            'protocol': [p.to_solr_value() for p in self.get_protocols_used()],
            'part': [s.to_solr_value() for s in self.get_strains_used()],
            'aclr': [p.__str__() for p in self.get_combined_permission() if p.is_read()],
            'aclw': [p.__str__() for p in self.get_combined_permission() if p.is_write()],
        }

    def user_can_read(self, user):
        return any(p.is_read() for p in chain(
                self.userpermission_set.filter(user=user),
                self.grouppermission_set.filter(group=user.groups.all())
        ))

    def user_can_write(self, user):
        return any(p.is_write() for p in chain(
                self.userpermission_set.filter(user=user),
                self.grouppermission_set.filter(group=user.groups.all())
        ))

    def get_combined_permission(self):
        return chain(self.userpermission_set.all(), self.grouppermission_set.all())

    def get_contact(self):
        if self.contact is None:
            return self.contact_extra
        return self.contact.email

    def get_line_metadata_types(self):
        # TODO: add in strain, carbon source here? IFF exists a line with at least one
        # TODO: cannot go through non-existant Metadata object mapping now
        return list()

    def get_metabolite_types_used(self):
        return list(Metabolite.objects.filter(measurement__assay__line__study=self).distinct())

    def get_protocols_used(self):
        return list(Protocol.objects.filter(assay__line__study=self).distinct())

    def get_strains_used(self):
        return list(Strain.objects.filter(line__study=self).distinct())

    def get_assays (self) :
        return list(Assay.objects.filter(line__study=self))

    def get_assays_by_protocol (self) :
        protocols = Protocol.objects.all()
        assays_by_protocol = { p.id : [] for p in protocols }
        for assay in self.get_assays() :
            assays_by_protocol[assay.protocol.id].append(assay.id)
        return assays_by_protocol


class StudyPermission(models.Model):
    """
    Access given for a *specific* study instance, rather than for object types provided by Django.
    """
    class Meta:
        abstract = True
    NONE = 'N'
    READ = 'R'
    WRITE = 'W'
    TYPE_CHOICE = (
        (NONE, 'None'),
        (READ, 'Read'),
        (WRITE, 'Write'),
    )
    study = models.ForeignKey(Study)
    permission_type = models.CharField(max_length=8, choices=TYPE_CHOICE, default=NONE)

    def applies_to_user(self, user):
        """
        Test if permission applies to given user.

        Base class will always return False, override in child classes.
        Arguments:
            user: to be tested, model from django.contrib.auth.models.User
        Returns:
            True if StudyPermission applies to the User
        """
        return False;

    def is_read(self):
        """
        Test if the permission grants read privileges.

        Returns:
            True if permission grants read
        """
        return self.permission_type == self.READ or self.permission_type == self.WRITE

    def is_write(self):
        """
        Test if the permission grants write privileges.

        Returns:
            True if permission grants write
        """
        return self.permission_type == self.WRITE


class UserPermission(StudyPermission):
    class Meta:
        db_table = 'study_user_permission'
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='userpermission_set')

    def applies_to_user(self, user):
        return self.user == user

    def __str__(self):
        return 'u:%(user)s' % {'user':self.user.username}


class GroupPermission(StudyPermission):
    class Meta:
        db_table = 'study_group_permission'
    group = models.ForeignKey('auth.Group', related_name='grouppermission_set')

    def applies_to_user(self, user):
        return user.groups.contains(user)

    def __str__(self):
        return 'g:%(group)s' % {'group':self.group.name}


class Protocol(EDDObject):
    """
    A defined method of examining a Line.
    """
    class Meta:
        db_table = 'protocol'
    object_ref = models.OneToOneField(EDDObject, parent_link=True)
    owned_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='protocol_set')
    active = models.BooleanField(default=True)
    variant_of = models.ForeignKey('self', blank=True, null=True, related_name='derived_set')
    default_units = models.ForeignKey('MeasurementUnit', blank=True,
        null=True, related_name="protocol_set")

    def creator(self):
        return self.created.mod_by

    def owner(self):
        return self.owned_by

    def last_modified(self):
        return self.updated.mod_time

    def last_modified_str (self) :
        return self.updated.format_timestamp()

    def to_solr_value(self):
        return '%(id)s@%(name)s' % {'id':self.pk, 'name':self.name}

    def __str__(self):
        return self.name

    def to_json (self) :
        return {
            "name" : self.name,
            "disabled" : not self.active,
        }

    @classmethod
    def from_form (cls, name, user, variant_of_id=None) :
        all_protocol_names = set([ p.name for p in Protocol.objects.all() ])
        if (name in ["", None]) :
            raise ValueError("Protocol name required.")
        elif (name in all_protocol_names) :
            raise ValueError("There is already a protocol named '%s'." % name)
        variant_of = None
        if (not variant_of_id in [None, "", "all"]) :
            variant_of = Protocol.objects.get(pk=variant_of_id)
        return Protocol.objects.create(
            name=name,
            owned_by=user,
            active=True,
            variant_of=variant_of)

    @property
    def categorization (self) :
        """
        The 'categorization' determines what broad category the Protocol falls
        into with respect to how its Metabolite data should be processed
        internally.  The categorizations used so far are the strings
        'OD', 'HPLC', 'LCMS', and 'RAMOS', and the catch-all 'Unknown'.
        """
        # FIXME This is not the best way of doing it, depending as it does
        # on the arbitrary naming conventions used by scientists creating new
        # Protocols, so it will probably need replacing later on.
        c = "Unknown"
        name = self.name.upper()
        if (name == "OD600") :
            return "OD"
        elif ("HPLC" in name) :
            return "HPLC"
        elif (re.match("^LC[\-\/]?", name) or  re.match("^GC[\-\/]?", name)) :
            return "LCMS"
        elif re.match("O2\W+CO2", name) :
            return "RAMOS"
        elif ("TRANSCRIPTOMICS" in name) or ("PROTEOMICS" in name) :
            return "TPOMICS"
        else :
            return "Unknown"

# methods used both in Strain and CarbonSource
def _n_lines (self) :
    return self.line_set.count()

def _n_studies (self) :
    lines = self.line_set.all()
    return len(set([ l.study_id for l in lines ]))


class Strain(EDDObject):
    """
    A link to a strain/part in the JBEI ICE Registry.
    """
    class Meta:
        db_table = 'strain'
    object_ref = models.OneToOneField(EDDObject, parent_link=True)
    registry_id = PostgreSQLUUIDField(blank=True, null=True)
    registry_url = models.URLField(max_length=255, blank=True, null=True)
    active = models.BooleanField(default=True)

    def to_solr_value(self):
        return '%(id)s@%(name)s' % {'id':self.registry_id, 'name':self.name}

    def __str__(self):
        return self.name

    def to_json(self):
        return {
            "id" : self.pk,
            "name" : self.name,
            "desc" : self.description,
            "disabled" : not self.active,
            "registry_id" : self.registry_id,
            "registry_url" : self.registry_url,
        }

    @property
    def n_lines (self) : return _n_lines(self)

    @property
    def n_studies (self) : return _n_studies(self)


class CarbonSource(EDDObject):
    """
    Information about carbon sources, isotope labeling.
    """
    class Meta:
        db_table = 'carbon_source'
    object_ref = models.OneToOneField(EDDObject, parent_link=True)
    # Labeling is description of isotope labeling used in carbon source
    labeling = models.TextField()
    volume = models.DecimalField(max_digits=16, decimal_places=5)
    active = models.BooleanField(default=True)

    def to_json (self) :
        return {
            "id" : self.pk,
            "carbon" : self.name,
            "labeling" : self.labeling,
            "initials" : self.created.initials,
            "vol" : self.volume,
            "mod" : self.mod_epoch,
            "modstr" : str(self.updated),
            "ainfo" : self.description,
            "userid" : None, # TODO
            "disabled" : not self.active,
        }

    @property
    def n_lines (self) : return _n_lines(self)

    @property
    def n_studies (self) : return _n_studies(self)

    def __str__ (self) :
        return "%s (%s)" % (self.name, self.labeling)


class Line(EDDObject):
    """
    A single item to be studied (contents of well, tube, dish, etc).
    """
    class Meta:
        db_table = 'line'
    study = models.ForeignKey(Study)
    control = models.BooleanField(default=False)
    replicate = models.ForeignKey('self', blank=True, null=True)
    object_ref = models.OneToOneField(EDDObject, parent_link=True)
    contact = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True,
                                related_name='line_contact_set')
    contact_extra = models.TextField()
    experimenter = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True,
                                     related_name='line_experimenter_set')
    active = models.BooleanField(default=True)
    carbon_source = models.ManyToManyField(CarbonSource, db_table='line_carbon_source')
    protocols = models.ManyToManyField(Protocol, through='Assay')
    strains = models.ManyToManyField(Strain, db_table='line_strain')

    def to_json(self):
        updated = self.updated
        created = self.created
        return {
            'id': self.pk,
            'name': self.name,
            'description': self.description,
            'active': self.active,
            'control': self.control,
            'replicate': self.replicate.pk if self.replicate else None,
            'contact': { 'user_id': self.contact_id, 'text': self.contact_extra },
            'experimenter': self.experimenter_id,
            'meta': self.get_metadata_json(), # FIXME is this correct?
            'strain': [s.pk for s in self.strains.all()],
            'carbon': [c.pk for c in self.carbon_source.all()],
            'modified': updated.to_json() if updated else None,
            'created': created.to_json() if created else None,
        }

    @property
    def primary_strain_name (self) :
        strains = self.strains.all()
        if (len(strains) > 0) :
          return strains[0].name
        return None

    @property
    def strain_ids (self) :
        """
        String representation of associated strains; used in views.
        """
        return ",".join([ s.name for s in self.strains.all() ])

    @property
    def carbon_source_info (self) :
        """
        String representation of carbon source(s) with labeling included;
        used in views.
        """
        return ",".join([ str(cs) for cs in self.carbon_source.all() ])

    @property
    def carbon_source_name (self) :
        """
        String representation of carbon source(s); used in views.
        """
        return ",".join([ cs.name for cs in self.carbon_source.all() ])

    @property
    def carbon_source_labeling (self) :
        """
        String representation of labeling (if any); used in views.
        """
        return ",".join([str(cs.labeling) for cs in self.carbon_source.all()])

    @property
    def media (self) :
        return self.get_metadata_dict().get("Media", None)

    def new_assay_number (self, protocol) :
        """
        Given a Protocol name, fetch all matching child Assays, attempt to
        convert their names into integers, and return the next highest integer
        for creating a new assay.  (This will result in duplication of names
        for Assays of different protocols under the same Line, but the frontend
        displays Assay.long_name, which should be unique.)
        """
        if isinstance(protocol, basestring) : # assume Protocol.name
            protocol = Protocol.objects.get(name=protocol)
        assays = self.assay_set.filter(protocol=protocol)
        existing_assay_numbers = []
        for assay in assays :
            try :
                existing_assay_numbers.append(int(assay.name))
            except ValueError :
                pass
        assay_start_id = 1
        if (len(existing_assay_numbers) > 0) :
            assay_start_id = max(existing_assay_numbers) + 1
        return assay_start_id

class MeasurementGroup(object):
    """
    Does not need its own table in database, but multiple models will reference measurements that
    are specific to a specific group category: metabolomics, proteomics, etc.
    """
    GENERIC = '_'
    METABOLITE = 'm'
    GENEID = 'g'
    PROTEINID = 'p'
    GROUP_CHOICE = (
        (GENERIC, 'Generic'),
        (METABOLITE, 'Metabolite'),
        (GENEID, 'Gene Identifier'),
        (PROTEINID, 'Protein Identifer'),
    )

class MeasurementType(models.Model):
    """
    Defines the type of measurement being made. A generic measurement only has name and short name;
    if the type is a metabolite, the metabolite attribute will contain additional metabolite info.
    """
    class Meta:
        db_table = 'measurement_type'
    type_name = models.CharField(max_length=255)
    short_name = models.CharField(max_length=255, blank=True, null=True)
    type_group = models.CharField(max_length=8,
                                  choices=MeasurementGroup.GROUP_CHOICE,
                                  default=MeasurementGroup.GENERIC)

    def to_solr_value(self):
        return '%(id)s@%(name)s' % {'id':self.pk, 'name':self.type_name}

    def to_json(self):
        return {
            "id": self.pk,
            "name": self.type_name,
            "sn": self.short_name,
            "family": self.type_group,
        }

    def __str__(self):
        return self.type_name

    def is_metabolite (self) :
        return self.type_group == MeasurementGroup.METABOLITE

    def is_protein (self) :
        return self.type_group == MeasurementGroup.PROTEINID

    def is_gene (self) :
        return self.type_group == MeasurementGroup.GENEID

    @classmethod
    def proteins (cls) :
        """
        Return all instances of protein measurements.
        """
        return cls.objects.filter(type_group=MeasurementGroup.PROTEINID)

    @classmethod
    def proteins_by_name (cls) :
        """
        Generate a dictionary of proteins keyed by name.
        """
        return {p.type_name : p for p in cls.proteins().order_by("type_name")}

    @classmethod
    def create_protein (cls, type_name, short_name=None) :
        return cls.objects.create(
            type_name=type_name,
            short_name=short_name,
            type_group=MeasurementGroup.PROTEINID)

    # http://stackoverflow.com/questions/3409047
    @classmethod
    def all_sorted_by_short_name (cls) :
        """
        Returns a query set sorted by the short_name field in case-insensitive
        order.  (Mostly useful for the Metabolite subclass.)
        """
        return cls.objects.all().prefetch_related('keywords').extra(
            select={'lower_name':'lower(short_name)'}).order_by('lower_name')


class MetaboliteKeyword (models.Model) :
    class Meta:
        db_table = "metabolite_keyword"
    name = models.CharField(max_length=255, unique=True)
    mod_by = models.ForeignKey(settings.AUTH_USER_MODEL)

    def __str__ (self) :
        return self.name

    @classmethod
    def all_with_metabolite_ids (cls) :
        keywords = []
        kwd_objects = cls.objects.all().order_by("name").prefetch_related(
            "metabolite_set")
        for keyword in kwd_objects :
            ids_dicts = keyword.metabolite_set.values("id")
            keywords.append({
                "id" : keyword.id,
                "name" : keyword.name,
                "metabolites" : [ i_d['id'] for i_d in ids_dicts ],
            })
        return keywords


class Metabolite(MeasurementType):
    """
    Defines additional metadata on a metabolite measurement type; charge, carbon count, molar mass,
    and molecular formula.
    TODO: aliases for metabolite type_name/short_name
    TODO: datasource; BiGG vs JBEI-created records
    TODO: links to kegg files?
    """
    class Meta:
        db_table = 'metabolite'
    charge = models.IntegerField()
    carbon_count = models.IntegerField()
    molar_mass = models.DecimalField(max_digits=16, decimal_places=5)
    molecular_formula = models.TextField()
    keywords = models.ManyToManyField(MetaboliteKeyword,
        db_table="metabolites_to_keywords")

    def is_metabolite (self) :
        return True

    def to_json(self):
        """
        Export a serializable dictionary.  Because this will access all
        associated keyword objects, it is recommended to include a call to
        query.prefetch_related("keywords") when selecting metabolites in bulk.
        """
        return dict(super(Metabolite, self).to_json(), **{
            # FIXME the alternate names pointed to by the 'ans' key are
            # supposed to come from the 'alternate_metabolite_type_names'
            # table in the old EDD, but this is actually empty.  Do we need it?
            "ans" : "",
            "f" : self.molecular_formula,
            "mm" : float(self.molar_mass),
            "cc" : self.carbon_count,
            "chg" : self.charge,
            "chgn" : self.charge, # TODO find anywhere in typescript using this and fix it
            "kstr" : ",".join([ str(k) for k in self.keywords.all() ])
        })

    @property
    def keywords_str (self) :
        return ", ".join([ str(k) for k in self.keywords.all() ])

    def add_keyword (self, keyword) :
        try :
            kw_obj = MetaboliteKeyword.objects.get(name=keyword)
        except ObjectDoesNotExist as e :
            raise ValueError("'%s' is not a valid keyword." % keyword)
        else :
            self.keywords.add(kw_obj)

    def set_keywords (self, keywords) :
        """
        Given a collection of keywords (as strings), link this metabolite to
        the equivalent MetaboliteKeyword object(s).
        """
        new_keywords = set(keywords)
        current_kwds = { kw.name:kw for kw in self.keywords.all() }
        for keyword in keywords : # step 1: add new keywords
            if (keyword in current_kwds) :
                continue
            self.add_keyword(keyword)
        for keyword in current_kwds : # step 2: remove obsolete keywords
            if (not keyword in new_keywords) :
                self.keywords.remove(current_kwds[keyword])

class GeneIdentifier(MeasurementType):
    """
    Defines additional metadata on gene identifier transcription measurement type.
    """
    class Meta:
        db_table = 'gene_identifier'
    location_in_genome = models.TextField(blank=True, null=True)
    positive_strand = models.BooleanField(default=True)
    location_start = models.IntegerField(blank=True, null=True)
    location_end = models.IntegerField(blank=True, null=True)
    gene_length = models.IntegerField(blank=True, null=True)

    @classmethod
    def by_name (cls) :
        """
        Generate a dictionary of genes keyed by name.
        """
        genes = cls.objects.all().order_by("type_name")
        return { g.type_name : g for g in genes }


# Commented out until there is more to ProteinIdentifier than what already is in MeasurementType
# class ProteinIdentifier(MeasurementType):
#     """
#     Defines additional metadata on gene identifier transcription measurement type.
#     """
#     class Meta:
#         db_table = 'protein_identifier'


class MeasurementUnit(models.Model):
    """
    Defines a unit type and metadata on measurement values.
    """
    class Meta:
        db_table = 'measurement_unit'
    unit_name = models.CharField(max_length=255, unique=True)
    display = models.BooleanField(default=True)
    alternate_names = models.CharField(max_length=255, blank=True, null=True)
    type_group = models.CharField(max_length=8,
                                  choices=MeasurementGroup.GROUP_CHOICE,
                                  default=MeasurementGroup.GENERIC)

    def to_json (self) :
        return { "name" : self.unit_name }

    @property
    def group_name (self) :
        return dict(MeasurementGroup.GROUP_CHOICE)[self.type_group]

    @classmethod
    def all_sorted (cls) :
        return cls.objects.filter(display=True).extra(
            select={'lower_name':'lower(unit_name)'}).order_by('lower_name')

class Assay(EDDObject):
    """
    An examination of a Line, containing the Protocol and set of Measurements.
    """
    class Meta:
        db_table = 'assay'
    line = models.ForeignKey(Line)
    protocol = models.ForeignKey(Protocol)
    object_ref = models.OneToOneField(EDDObject, parent_link=True)
    experimenter = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True,
                                     related_name='assay_experimenter_set')
    active = models.BooleanField(default=True)
    measurement_types = models.ManyToManyField(MeasurementType, through='Measurement')

    def get_metabolite_measurements (self) :
        return self.measurement_set.filter(
            measurement_type__type_group=MeasurementGroup.METABOLITE)

    def get_protein_measurements (self) :
        return self.measurement_set.filter(
            measurement_type__type_group=MeasurementGroup.PROTEINID)

    def get_gene_measurements (self) :
        return self.measurement_set.filter(
            measurement_type__type_group=MeasurementGroup.GENEID)

    @property
    def long_name (self) :
        return "%s-%s-%s" % (self.line.name, self.protocol.name, self.name)

    def to_json (self) :
        return {
            "id": self.pk,
            # TODO remove this section of deprecated properties
            "fn" : self.name,
            "ln" : self.line.name,
            "an" : self.name,
            "des" : self.description,
            "dis" : not self.active,
            # TODO end remove
            "name": self.name,
            "description": self.description,
            "active" : self.active,
            "lid" : self.line.pk,
            "pid" : self.protocol.pk,
            "mod" : str(self.updated),
            "exp" : self.experimenter.id,
            "meta": self.get_metadata_json(),
            "measurements": list(self.measurement_set.values_list('id', flat=True)),
            "metabolites": list(self.get_metabolite_measurements().values_list('id', flat=True)),
            "transcriptions": list(self.get_gene_measurements().values_list('id', flat=True)),
            "proteins": list(self.get_protein_measurements().values_list('id', flat=True)),
        }


class MeasurementCompartment (object) :
    UNKNOWN, INTRACELLULAR, EXTRACELLULAR = range(3)
    short_names = ["", "IC", "EC"]
    names = ["", "Intracellular/Cytosol (Cy)", "Extracellular"]
    GROUP_CHOICE = ( (str(i), cn) for (i,cn) in enumerate(names) )

class MeasurementFormat (object) :
    FORMAT_CHOICE = ( str(i) for i in range(3) )
    SCALAR, VECTOR, GRID = FORMAT_CHOICE

class Measurement(models.Model):
    """
    A plot of data points for an (assay, measurement type) pair. Points can either be single (x,y)
    or an (x, (y0, y1, ... , yn)) scalar and vector.
    """
    class Meta:
        db_table = 'measurement'
    assay = models.ForeignKey(Assay)
    experimenter = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True,
                                     related_name='measurement_experimenter_set')
    measurement_type = models.ForeignKey(MeasurementType)
    x_units = models.ForeignKey(MeasurementUnit, related_name='+')
    y_units = models.ForeignKey(MeasurementUnit, related_name='+')
    update_ref = models.ForeignKey(Update, related_name='+')
    active = models.BooleanField(default=True)
    compartment = models.CharField(max_length=1,
                                   choices=MeasurementCompartment.GROUP_CHOICE,
                                   default=MeasurementCompartment.UNKNOWN)
    # TODO: verify what this value means; carbon ratio data if 1? should be parameter of MeasurementType?
    measurement_format = models.CharField(max_length=2,
        choices=MeasurementFormat.FORMAT_CHOICE,
        default=MeasurementFormat.SCALAR)

    def to_json(self):
        points = chain(self.measurementdatum_set.all(), self.measurementvector_set.all())
        return {
            "id": self.pk,
            "assay": self.assay.pk,
            "type": self.measurement_type.pk,
            "compartment": self.compartment,
            "format": self.measurement_format,
            "values": map(lambda p: p.to_json(), points),
            "x_units": self.x_units.pk,
            "y_units": self.y_units.pk,
        }

    def __str__(self):
        return 'Measurement{%d}{%s}' % (self.assay.id, self.measurement_type)

    def is_gene_measurement (self) :
        return self.measurement_type.type_group == MeasurementGroup.GENEID

    def is_protein_measurement (self) :
        return self.measurement_type.type_group == MeasurementGroup.PROTEINID

    # may not be the best method name, if we ever want to support other
    # types of data as vectors in the future
    def is_carbon_ratio (self) :
        return (int(self.measurement_format) == 1)

    def valid_data (self) :
        """Data (either MeasurementDatum or MeasurementVector objects) for
        which the y-value is defined (non-NULL, non-blank)."""
        mdata = list(self.data())
        return [ md for md in mdata if md.is_defined() ]

    def is_extracellular (self) :
        return self.compartment == str(MeasurementCompartment.EXTRACELLULAR)

    def data (self) :
        """
        Return the data associated with this measurement.  This can be either
        a scalar (x,y) (MeasurementDatum) or vector (x,y1/y2/y3/...)
        (MeasurementVector) at present, but not both.
        """
        if (int(self.measurement_format) == 0) :
            return self.measurementdatum_set.all()
        elif (int(self.measurement_format) == 1) :
            return self.measurementvector_set.all()
        else :
            raise NotImplementedError("Measurement format %s not supported." %
                self.measurement_format)

    @property
    def name (self) :
        """alias for self.measurement_type.type_name"""
        return self.measurement_type.type_name

    @property
    def short_name (self) :
        """alias for self.measurement_type.short_name"""
        return self.measurement_type.short_name

    @property
    def compartment_symbol (self) :
        return MeasurementCompartment.short_names[int(self.compartment)]

    @property
    def full_name (self) :
        """measurement compartment plus measurement_type.type_name"""
        return ({"0":"","1":"IC","2":"EC"}.get(self.compartment) +
                " " + self.name).strip()

    # TODO also handle vectors
    def extract_data_xvalues (self, defined_only=False) :
        mdata = list(self.data())
        if defined_only :
            return [ m.fx for m in mdata if m.is_defined() ]
        else :
            return [ m.fx for m in mdata ]

    # this shouldn't need to handle vectors
    def interpolate_at (self, x) :
        assert (int(self.measurement_format) == 0)
        from main.utilities import interpolate_at
        return interpolate_at(self.valid_data(), x)

    @property
    def y_axis_units_name (self) :
        """Human-readable units for Y-axis.  Not intended for repeated/bulk use,
        since it involves a foreign key lookup."""
        return self.y_units.unit_name

    def is_concentration_measurement (self) :
        return (self.y_axis_units_name in
                ["mg/L", "g/L", "mol/L", "mM", "uM", "Cmol/L"])


class MeasurementDatum(models.Model):
    """
    A pair of scalars (x,y) as part of a Measurement.
    """
    class Meta:
        db_table = 'measurement_datum'
    measurement = models.ForeignKey(Measurement)
    x = models.DecimalField(max_digits=16, decimal_places=5)
    y = models.DecimalField(max_digits=16, decimal_places=5, blank=True, null=True)
    updated = models.ForeignKey(Update, related_name='+')

    def to_json(self):
        return {
            "id": self.pk,
            "x": self.x,
            "y": self.y,
        }

    def __str__(self):
        return '(%f,%f)' % (self.x, self.y)

    @property
    def fx (self) :
        """Returns self.x as a Python float"""
        return float(self.x)

    @property
    def fy (self) :
        """Returns self.y as a Python float OR None if undefined"""
        if self.is_defined() :
            return float(self.y)
        return None

    def is_defined (self) :
        return (self.y is not None)

    def export_value (self) :
        """
        Convert the value to something we can put in a table, etc.; the
        DecimalField will appear as Decimal('1.2345'), which is not what we
        want to see.
        """
        return self.fy

class MeasurementVector(models.Model):
    """
    A scalar-vector pair (x, (y0, y1, ... , yn)) as part of a Measurement.
    """
    class Meta:
        db_table = 'measurement_vector'
    measurement = models.ForeignKey(Measurement)
    x = models.DecimalField(max_digits=16, decimal_places=5)
    y = models.TextField()
    updated = models.ForeignKey(Update, related_name='+')

    def to_json(self):
        return {
            "id": self.pk,
            "x": self.x,
            "y": self.y,
        }

    def __str__(self):
        return '(%f,%f)' % (self.x, self.y)

    @property
    def fx (self) :
        return float(self.x)

    def is_defined (self) :
        return (self.y is not None) and (self.y != "")

    def export_value (self) :
        """For API compatibility with MeasurementDatum"""
        return str(self.y)

class SBMLTemplate (EDDObject) :
    """
    Container for information used in SBML export.
    """
    class Meta:
        db_table = "sbml_template"
    object_ref = models.OneToOneField(EDDObject, parent_link=True)
    biomass_calculation = models.DecimalField(default=-1, decimal_places=5,
        max_digits=16) # XXX check that these parameters make sense!
    biomass_calculation_info = models.TextField(default='')
    biomass_exchange_name = models.TextField()

    @property
    def xml_file (self) :
        files = list(self.files.all())
        if (len(files) == 0) :
            raise RuntimeError("No attachments found for metabolic map %s!" %
                self.name)
        #elif (len(files) > 1) :
        #    raise RuntimeError("Multiple attachments found for metabolic map "+
        #      "%s!" % self.name)
        return files[-1]

    def parseSBML (self) :
        import libsbml
        return libsbml.readSBML(str(self.xml_file.file.path))

class MetaboliteExchange (models.Model) :
    """
    Mapping for a metabolite to an exchange defined by a SBML template.
    """
    class Meta:
        db_table = "measurement_type_to_exchange"
        unique_together = ( ("sbml_template", "measurement_type"), )
    sbml_template = models.ForeignKey(SBMLTemplate)
    measurement_type = models.ForeignKey(MeasurementType)
    reactant_name = models.CharField(max_length=255)
    exchange_name = models.CharField(max_length=255)


class MetaboliteSpecies (models.Model) :
    """
    Mapping for a metabolite to an species defined by a SBML template.
    """
    class Meta:
        db_table = "measurement_type_to_species"
        unique_together = ( ("sbml_template", "measurement_type"), )
    sbml_template = models.ForeignKey(SBMLTemplate)
    measurement_type = models.ForeignKey(MeasurementType)
    species = models.TextField()


# XXX MONKEY PATCHING
def User_initials (self) :
    try :
        return self.userprofile.initials
    except ObjectDoesNotExist as e :
        return None

def User_institution (self) :
    try :
        institutions = self.userprofile.institutions.all()
        if (len(institutions) > 0) :
            return institutions[0].institution_name
        return None
    except ObjectDoesNotExist as e :
        return None

def User_to_json(self):
    # FIXME this may be excessive - how much does the frontend actually need?
    return {
        "id" : self.pk,
        "uid": self.username,
        "email": self.email,
        "initials": self.initials,
        "name" : self.get_full_name(),
        "institution":self.institution,
        "description":"",
        "lastname":self.last_name,
        "groups":None,
        "firstname":self.first_name,
        "disabled":not self.is_active
    }

def User_to_solr_json(self):
    p = self.userprofile
    format_string = '%Y-%m-%dT%H:%M:%SZ'
    return {
        'id': self.pk,
        'username': self.username,
        'name': [ self.first_name, self.last_name ],
        'email': self.email,
        'initials': p.initials,
        'group': ['@'.join((str(g.pk), g.name)) for g in self.groups.all()],
        'institution': ['@'.join((str(i.pk), i.institution_name)) for i in p.institutions.all()],
        'date_joined': self.date_joined.strftime(format_string),
        'last_login': self.last_login.strftime(format_string),
        'is_active': self.is_active,
        'is_staff': self.is_staff,
        'is_superuser': self.is_superuser,
    }

# this will get replaced by the actual model as soon as the app is initialized
User = None
def patch_user_model () :
    global User
    User = get_user_model()
    User.add_to_class("to_json", User_to_json)
    User.add_to_class("to_solr_json", User_to_solr_json)
    User.add_to_class("initials", property(User_initials))
    User.add_to_class("institution", property(User_institution))
