import logging
import os
import re
import sys
import uuid
import yaml

LOG = logging.getLogger(__name__)


FIRST_CAP_RE = re.compile("(.)([A-Z][a-z]+)")
ALL_CAP_RE = re.compile("([a-z0-9])([A-Z])")


def exit_with_code(code, msg=""):
    if msg:
        LOG.error(msg)
    sys.exit(code)


def get_program_name(base_name: str = 'iact3') -> str:
    prefix = os.environ.get('ALIBABA_CLOUD_IACT3_COMPAT_MODE', '').strip()
    return f'{prefix} {base_name}' if prefix else base_name


def make_dir(path, ignore_exists=True):
    path = os.path.abspath(path)
    if ignore_exists and os.path.isdir(path):
        return
    os.makedirs(path)


def pascal_to_snake(pascal):
    sub = ALL_CAP_RE.sub(r"\1_\2", pascal)
    return ALL_CAP_RE.sub(r"\1_\2", sub).lower()


def generate_client_token_ex(prefix: str, suffix: str):
    if prefix:
        t = [prefix]
    else:
        t = []
    t.append(str(uuid.uuid1())[:-13])
    t.append(suffix)
    r = '_'.join(t)
    if len(r) > 64:
        r = r[:64]
    return r


ROS_FUNCTION_NAMES = {
    "MergeMap",
    "Sub",
    "Base64Decode",
    "Indent",
    "Base64",
    "If",
    "EachMemberIn",
    "FormatTime",
    "Length",
    "Not",
    "Replace",
    "Min",
    "Equals",
    "Test",
    "Split",
    "Join",
    "ListMerge",
    "Or",
    "ResourceFacade",
    "SelectMapList",
    "MergeMapToList",
    "Select",
    "Calculate",
    "FindInMap",
    "MarketplaceImage",
    "GetAZs",
    "Any",
    "Contains",
    "Add",
    "Str",
    "GetAtt",
    "Base64Encode",
    "GetStackOutput",
    "TransformNamespace",
    "Jq",
    "Max",
    "MemberListToMap",
    "Index",
    "Cidr",
    "GetJsonValue",
    "Ref",
    "And",
    "Avg",
    "MatchPattern",
    "Sub",
}


class CustomSafeLoader(yaml.SafeLoader):
    pass


def make_constructor(fun_name):
    if fun_name == 'Ref':
        tag_name = fun_name
    else:
        tag_name = 'Fn::{}'.format(fun_name)

    if fun_name == 'GetAtt':

        def get_attribute_constructor(loader, node):
            if isinstance(node, yaml.ScalarNode):
                value = loader.construct_scalar(node)
                try:
                    split_value = value.split('.')
                    if len(split_value) == 2:
                        resource, attribute = split_value
                    elif len(split_value) >= 3:
                        if split_value[-2] == 'Outputs':
                            resource = '.'.join(split_value[:-2])
                            attribute = '.'.join(split_value[-2:])
                        else:
                            resource = '.'.join(split_value[:-1])
                            attribute = split_value[-1]
                    else:
                        raise ValueError
                    return {tag_name: [resource, attribute]}
                except ValueError:
                    raise ValueError('Resolve !GetAtt error. Value: {}'.format(value))
            elif isinstance(node, yaml.SequenceNode):
                values = loader.construct_sequence(node)
                return {tag_name: values}
            else:
                value = loader.construct_object(node)
                return {tag_name: value}

        return get_attribute_constructor

    def constructor(loader, node):
        if isinstance(node, yaml.nodes.ScalarNode):
            value = loader.construct_scalar(node)
        elif isinstance(node, yaml.nodes.SequenceNode):
            value = loader.construct_sequence(node)
        elif isinstance(node, yaml.nodes.MappingNode):
            value = loader.construct_mapping(node)
        else:
            value = loader.construct_object(node)
        return {tag_name: value}

    return constructor


for f in ROS_FUNCTION_NAMES:
    CustomSafeLoader.add_constructor(f'!{f}', make_constructor(f))


# Size priority for ECS instance types (smaller = cheaper)
_INSTANCE_SIZE_ORDER = {
    'micro': 0, 'small': 1, 'medium': 2, 'large': 3,
    'xlarge': 4, '2xlarge': 5, '2.5xlarge': 6, '3xlarge': 7,
    '4xlarge': 8, '6xlarge': 9, '8xlarge': 10, '10xlarge': 11,
    '13xlarge': 12, '15xlarge': 13, '16xlarge': 14, '26xlarge': 15,
    '32xlarge': 16, '52xlarge': 17,
}
# Entry-level families (cheapest, suitable for testing)
_ENTRY_FAMILIES = ('t6', 't5', 's6', 's5', 'n4', 'mn4', 'xn4', 'e', 'e4', 'u1')

# Family priority for tie-breaking (lower = cheaper family)
_FAMILY_PRIORITY = {
    't6': 0, 't5': 1, 's6': 2, 's5': 3,
    'n4': 4, 'mn4': 5, 'xn4': 6,
    'u1': 7, 'e': 8, 'e4': 9,
    # Economy families
    'i5e': 10, 'i5': 11, 'i4': 12, 'i3': 13,
    'u2': 14,
    # General purpose
    'g6': 20, 'g5': 21, 'g7': 22,
    # Compute optimized
    'c6': 23, 'c5': 24, 'c7': 25,
    # Memory optimized
    'r6': 26, 'r5': 27, 'r7': 28,
}


def pick_cheapest_instance_type(types):
    """Pick the cheapest instance type from a list.

    Prefers entry-level families (t6, t5, s6, etc.) and smallest sizes
    to minimize cost for testing.
    """
    if not types:
        return None

    def _size_key(type_id):
        tl = type_id.lower()
        for size, pri in sorted(_INSTANCE_SIZE_ORDER.items(), key=lambda x: -len(x[0])):
            if size in tl:
                return pri
        return 99

    def _family_key(type_id):
        """Extract family priority from type ID (e.g. ecs.t6.large -> 0)."""
        tl = type_id.lower()
        if tl.startswith('ecs.'):
            rest = tl[4:]
            for sep in ('.', '-'):
                idx = rest.find(sep)
                if idx > 0:
                    return _FAMILY_PRIORITY.get(rest[:idx], 50)
        return 50

    def _is_entry(type_id):
        tl = type_id.lower()
        for f in _ENTRY_FAMILIES:
            if tl.startswith(f'ecs.{f}.') or tl.startswith(f'ecs.{f}-'):
                return True
        return False

    entry = [t for t in types if _is_entry(t)]
    pool = entry if entry else types
    # Sort by size first (cheapest), then by family (cheapest within same size)
    pool.sort(key=lambda t: (_size_key(t), _family_key(t)))
    return pool[0]


# === RDS DB Instance Class selection ===

# RDS instance class format: {engine}.{cpu_mem_ratio}.{spec}.{zone_count}
# e.g. mysql.x4.large.1c, pg.x8.medium.2c, mssql.n4.micro.1c

# Spec size priority (smaller = cheaper)
_DB_SPEC_ORDER = {
    'micro': 0, 'small': 1, 'medium': 2, 'large': 3,
    'xlarge': 4, '2xlarge': 5, '2.5xlarge': 6, '3xlarge': 7,
    '4xlarge': 8, '6xlarge': 9, '8xlarge': 10, '10xlarge': 11,
    '13xlarge': 12, '15xlarge': 13, '16xlarge': 14, '26xlarge': 15,
    '32xlarge': 16, '52xlarge': 17,
}

# CPU/memory ratio priority (lower ratio = cheaper)
_DB_RATIO_ORDER = {
    'n1': 0, 'n2': 1, 'n4': 2, 'x4': 2, 'x8': 3,
}


def sort_cheapest_db_instance_classes(values):
    """Sort RDS DB instance classes from cheapest to most expensive.

    Sorting priority:
    1. Spec size (micro < small < medium < large < xlarge < ...)
    2. CPU/memory ratio (n1 < n2 < n4/x4 < x8)
    3. Zone count (1c single-zone < 2c dual-zone)
    """
    if not values:
        return values

    def _spec_key(class_id):
        tl = class_id.lower()
        for spec, pri in sorted(_DB_SPEC_ORDER.items(), key=lambda x: -len(x[0])):
            if spec in tl:
                return pri
        return 99

    def _ratio_key(class_id):
        tl = class_id.lower()
        parts = tl.split('.')
        if len(parts) >= 2:
            return _DB_RATIO_ORDER.get(parts[1], 50)
        return 50

    def _zone_key(class_id):
        tl = class_id.lower()
        return 1 if tl.endswith('.2c') else 0

    return sorted(values, key=lambda t: (_spec_key(t), _ratio_key(t), _zone_key(t)))
