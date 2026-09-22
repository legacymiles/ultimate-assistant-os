"""Snippet builders for GAMEPLAY-FRAMEWORK inspection - read/light tools harvested from the UE5.8
Experimental Toolsets (GameplayTagsToolset, GASToolsets, GameFeaturesToolset, DataRegistryToolset,
AIModuleToolset). They INSPECT the gameplay systems IF the project uses them; harmless no-ops (empty
lists / 'not present' errors) if it doesn't. Primal Errors may well not use GAS/tags at all - these
just report what's there.

Each builder returns wrap(body); the shared PREAMBLE supplies _emit/_find_actor (+ _eas/_ues/_les).
Bodies are try/except so a missing binding returns {'error': ...} instead of crashing the bridge.

RISK NOTE (read before trusting any of these on metal):
The C++ toolsets these mirror call editor-module singletons (UGameplayTagsManager, UAbilitySystemGlobals,
UAbilitySystemBlueprintLibrary, UDataRegistrySubsystem, UGameFeaturesSubsystem). Whether each is reflected
into Python depends on the module being loaded AND the symbol carrying the right UFUNCTION/UCLASS exposure
flags. No generated unreal.py stub was present on disk at port time, so NONE of the GAS/Tag/DataRegistry
bindings below could be statically confirmed - every one carries a '# VERIFY:' marker. The ONLY sub-domain
proven against shipped engine Python is behavior_tree (AIModuleToolset ships its tools AS Python using
exactly the unreal.BehaviorTree / unreal.BTCompositeNode API mirrored here).

Bindings most likely to be ABSENT in Python (flagged inline, return a clean error if so):
  - UGameplayTagsManager.find_tag_node / get_child_tag_nodes (TSharedPtr<FGameplayTagNode> is not a UObject;
    the node tree is probably NOT reflected). request_all_gameplay_tags / request_gameplay_tag are the
    fallbacks most likely to exist.
  - UAbilitySystemGlobals.get_ability_system_component_from_actor (static BlueprintCallable - decent odds).
  - DataRegistry GetCachedItemRaw returns raw struct memory - GetItems almost certainly NOT Python-callable.
"""

import json

from unreal_mcp.snippets import wrap


# =====================================================================================================
# GameplayTags  (mirror: GameplayTagsToolset - INSPECTION subset only; AddTag/RemoveTag/RenameTag SKIPPED
#                as mutating-INI ops, see module footer)
# =====================================================================================================

def build_list_tags(parent_tag="") -> str:
    """List gameplay tags. Empty parent_tag = ALL registered tags; otherwise the descendants of parent_tag.

    Mirrors UGameplayTagsToolset::ListTags. The ALL path uses request_all_gameplay_tags (most likely
    reflected); the descendant path needs the FGameplayTagNode tree, which probably is NOT - flagged.
    """
    pt = json.dumps(parent_tag)
    body = (
        "try:\n"
        "    mgr = unreal.GameplayTagsManager.get()\n"   # VERIFY: UGameplayTagsManager reflected as unreal.GameplayTagsManager + static .get()
        "    parent = " + pt + "\n"
        "    names = []\n"
        "    if not parent:\n"
        "        cont = unreal.GameplayTagContainer()\n"
        "        cont = mgr.request_all_gameplay_tags(False)\n"   # VERIFY: request_all_gameplay_tags signature - C++ takes (OutContainer, bOnlyIncludeDictionaryTags); Python may return the container instead of out-param
        "        for t in cont.get_gameplay_tag_array():\n"       # VERIFY: FGameplayTagContainer.get_gameplay_tag_array() exposure
        "            names.append(str(t.to_string()))\n"
        "    else:\n"
        "        node = mgr.find_tag_node(unreal.Name(parent))\n"  # VERIFY: find_tag_node returns TSharedPtr<FGameplayTagNode> - very likely NOT Python-exposed; descendant listing may be impossible without C++
        "        if node is None:\n"
        "            _emit({'error': 'parent tag not found or tag-node tree not Python-exposed', 'parent': parent}); raise SystemExit\n"
        "        stack = list(node.get_child_tag_nodes())\n"       # VERIFY: get_child_tag_nodes exposure
        "        while stack:\n"
        "            n = stack.pop()\n"
        "            names.append(str(n.get_complete_tag_name()))\n"
        "            stack.extend(n.get_child_tag_nodes())\n"
        "    names = sorted(set(names))\n"
        "    _emit({'parent': parent, 'count': len(names), 'tags': names})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'GameplayTagsManager / tag-node tree may not be Python-exposed'})\n"
    )
    return wrap(body)


def build_get_tag_info(tag_name) -> str:
    """Info for one gameplay tag: dev comment, source ini, and immediate child tags.

    Mirrors UGameplayTagsToolset::GetTagInfo - needs the FGameplayTagNode (editor-only comment/source).
    """
    tn = json.dumps(tag_name)
    body = (
        "try:\n"
        "    mgr = unreal.GameplayTagsManager.get()\n"            # VERIFY: as build_list_tags
        "    node = mgr.find_tag_node(unreal.Name(" + tn + "))\n"  # VERIFY: find_tag_node + node accessors very likely NOT Python-exposed
        "    if node is None:\n"
        "        _emit({'error': 'tag not found or tag-node tree not Python-exposed', 'tag': " + tn + "}); raise SystemExit\n"
        "    info = {'tag': " + tn + ", 'children': [str(c.get_complete_tag_name()) for c in node.get_child_tag_nodes()]}\n"
        "    try:\n"
        "        info['comment'] = str(node.get_dev_comment())\n"     # VERIFY: WITH_EDITORONLY_DATA accessor exposure
        "        info['source'] = str(node.get_first_source_name())\n"  # VERIFY: same
        "    except Exception:\n"
        "        pass\n"
        "    _emit(info)\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'FGameplayTagNode likely not Python-exposed'})\n"
    )
    return wrap(body)


def build_find_referencers_by_tag(tag_name) -> str:
    """List asset packages that reference a gameplay tag (Asset Registry SearchableName lookup).

    Mirrors UGameplayTagsToolset::FindReferencersByTag. Uses request_gameplay_tag + the AssetRegistry,
    both of which ARE generally Python-reachable - this is the LEAST risky tag tool.
    """
    tn = json.dumps(tag_name)
    body = (
        "try:\n"
        "    mgr = unreal.GameplayTagsManager.get()\n"            # VERIFY: GameplayTagsManager.get()
        "    tag = mgr.request_gameplay_tag(unreal.Name(" + tn + "), False)\n"  # VERIFY: request_gameplay_tag(name, error_if_not_found) - good odds; returns FGameplayTag
        "    if not tag.is_valid():\n"
        "        _emit({'error': 'tag does not exist', 'tag': " + tn + "}); raise SystemExit\n"
        "    ar = unreal.AssetRegistryHelpers.get_asset_registry()\n"
        # VERIFY: FAssetIdentifier(SearchableName) construction from Python + get_referencers with SearchableName
        # dependency category is the hard part - the simple package-referencers API is exposed, the Searchable-name
        # identifier path may not be. If this errors, fall back to an execute_python AssetRegistry query.
        "    ident = unreal.AssetIdentifier(unreal.GameplayTag.static_struct(), tag.get_tag_name())\n"
        "    refs = ar.get_referencers(ident, unreal.AssetRegistryDependencyCategory.SEARCHABLE_NAME)\n"
        "    pkgs = sorted({str(r.package_name) for r in refs})\n"
        "    _emit({'tag': " + tn + ", 'referencer_count': len(pkgs), 'referencers': pkgs})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'SearchableName AssetIdentifier path may not be Python-exposed'})\n"
    )
    return wrap(body)


# =====================================================================================================
# GAS runtime inspection  (mirror: GASToolsets/AbilitySystemInspectorToolset + AttributeSetToolset)
# These resolve an ACTOR by label/name, fetch its AbilitySystemComponent, and report runtime state.
# THE RISKIEST sub-domain: live ASC + UAbilitySystemBlueprintLibrary statics.
# =====================================================================================================

# Helper compiled into ASC snippets: resolve actor -> ASC, _emit a clean error + raise SystemExit if absent.
_ASC = (
    "def _asc_for(ident):\n"
    "    a = _find_actor(ident)\n"
    "    if a is None:\n"
    "        _emit({'error': 'actor not found', 'actor': ident}); raise SystemExit\n"
    "    asc = None\n"
    "    try:\n"
    # VERIFY: UAbilitySystemGlobals static get_ability_system_component_from_actor - BlueprintCallable, decent odds.
    "        asc = unreal.AbilitySystemGlobals.get_ability_system_component_from_actor(a)\n"
    "    except Exception:\n"
    "        asc = None\n"
    "    if asc is None:\n"
    # VERIFY: fallback - find an AbilitySystemComponent by component class on the actor.
    "        try:\n"
    "            asc = a.get_component_by_class(unreal.AbilitySystemComponent)\n"
    "        except Exception:\n"
    "            asc = None\n"
    "    if asc is None:\n"
    "        _emit({'error': 'actor has no AbilitySystemComponent (or ASC not Python-exposed)', 'actor': ident}); raise SystemExit\n"
    "    return a, asc\n"
)


def build_gas_attributes(actor) -> str:
    """List an actor's gameplay-attribute base+current values (from its ASC's spawned AttributeSets).

    Mirrors UAbilitySystemInspectorToolset::GetAttributeValues. Hits UAttributeSet.get_attributes_from_set_class
    and UAbilitySystemBlueprintLibrary.get_float_attribute[_base] - all '# VERIFY' (no stub to confirm).
    """
    ai = json.dumps(actor)
    body = (
        _ASC
        + "try:\n"
        + "    actor, asc = _asc_for(" + ai + ")\n"
        + "    owner = asc.get_owner()\n"   # VERIFY: UAbilitySystemComponent.get_owner() exposure
        + "    out = []\n"
        + "    for s in asc.get_spawned_attributes():\n"   # VERIFY: get_spawned_attributes() exposure
        + "        if s is None:\n"
        + "            continue\n"
        + "        scls = s.get_class(); sname = scls.get_name()\n"
        + "        attrs = unreal.AttributeSet.get_attributes_from_set_class(scls)\n"   # VERIFY: static get_attributes_from_set_class(UClass)->TArray<FGameplayAttribute> exposure
        + "        for attr in attrs:\n"
        + "            aname = attr.get_name()\n"   # VERIFY: FGameplayAttribute.get_name() exposure
        + "            base = unreal.AbilitySystemBlueprintLibrary.get_float_attribute_base(owner, attr)\n"   # VERIFY: returns (value, bFound) tuple in Python (out-param bool)
        + "            cur = unreal.AbilitySystemBlueprintLibrary.get_float_attribute(owner, attr)\n"          # VERIFY: same tuple shape
        + "            base_v = base[0] if isinstance(base, tuple) else base\n"
        + "            cur_v = cur[0] if isinstance(cur, tuple) else cur\n"
        + "            out.append({'attribute': aname, 'set': sname, 'full_name': sname + '.' + aname,\n"
        + "                        'base': base_v, 'current': cur_v})\n"
        + "    out.sort(key=lambda d: d['full_name'])\n"
        + "    _emit({'actor': " + ai + ", 'count': len(out), 'attributes': out})\n"
        + "except SystemExit:\n"
        + "    pass\n"
        + "except Exception as e:\n"
        + "    _emit({'error': repr(e), 'hint': 'AbilitySystemBlueprintLibrary / AttributeSet statics may not be Python-exposed'})\n"
    )
    return wrap(body)


def build_gas_active_effects(actor) -> str:
    """List the GameplayEffects currently active on an actor's ASC (name, stacks, durations, granted tags).

    Mirrors UAbilitySystemInspectorToolset::GetActiveEffects. Iterating FActiveGameplayEffectsContainer from
    Python is the deep end - flagged HARD; likely needs C++ / an execute_python custom accessor.
    """
    ai = json.dumps(actor)
    body = (
        _ASC
        + "try:\n"
        + "    actor, asc = _asc_for(" + ai + ")\n"
        # VERIFY: there is NO clean BlueprintCallable to enumerate active effects with full detail. The C++ walks
        # FActiveGameplayEffectsContainer directly (not reflected). get_active_gameplay_effects() returns the
        # container struct; whether Python can iterate it is doubtful. We attempt the handle-based BP library path.
        + "    handles = asc.get_active_effects(unreal.GameplayEffectQuery())\n"   # VERIFY: UAbilitySystemComponent.get_active_effects(FGameplayEffectQuery) exposure - uncertain
        + "    out = []\n"
        + "    for h in handles:\n"
        + "        stacks = unreal.AbilitySystemBlueprintLibrary.get_active_gameplay_effect_stack_count(h)\n"   # VERIFY: BP lib static exposure
        + "        out.append({'handle': str(h), 'stack_count': stacks})\n"   # NOTE: name/duration/granted-tags need the GE def behind the handle; not reachable without more bindings
        + "    _emit({'actor': " + ai + ", 'count': len(out), 'effects': out,\n"
        + "           'note': 'effect NAME/duration/granted-tags need FActiveGameplayEffect access not reflected to Python; only handles+stacks available here'})\n"
        + "except SystemExit:\n"
        + "    pass\n"
        + "except Exception as e:\n"
        + "    _emit({'error': repr(e), 'hint': 'active-effect enumeration is largely C++-only; likely not Python-exposed'})\n"
    )
    return wrap(body)


def build_gas_abilities(actor) -> str:
    """List the abilities granted to an actor's ASC (name, level, is-active).

    Mirrors UAbilitySystemInspectorToolset::GetGrantedAbilities. Iterates ASC.GetActivatableAbilities()
    (FGameplayAbilitySpec) - the spec struct is probably NOT reflected; flagged.
    """
    ai = json.dumps(actor)
    body = (
        _ASC
        + "try:\n"
        + "    actor, asc = _asc_for(" + ai + ")\n"
        # VERIFY: GetActivatableAbilities() returns TArray<FGameplayAbilitySpec> - FGameplayAbilitySpec is a plain
        # struct, unlikely reflected with Ability/Level/IsActive accessors. High chance this whole tool is C++-only.
        + "    specs = asc.get_activatable_abilities()\n"   # VERIFY: get_activatable_abilities() exposure - uncertain
        + "    out = []\n"
        + "    for sp in specs:\n"
        + "        ab = getattr(sp, 'ability', None)\n"
        + "        nm = ab.get_class().get_name() if ab is not None else 'Unknown'\n"
        + "        out.append({'ability': nm, 'level': getattr(sp, 'level', None),\n"
        + "                    'is_active': bool(getattr(sp, 'active_count', 0))})\n"
        + "    out.sort(key=lambda d: d['ability'])\n"
        + "    _emit({'actor': " + ai + ", 'count': len(out), 'abilities': out})\n"
        + "except SystemExit:\n"
        + "    pass\n"
        + "except Exception as e:\n"
        + "    _emit({'error': repr(e), 'hint': 'FGameplayAbilitySpec likely not Python-exposed; expect this to be C++-only'})\n"
    )
    return wrap(body)


def build_gas_active_tags(actor) -> str:
    """List the gameplay tags currently OWNED by an actor's ASC (loose + effect-granted).

    Mirrors UAbilitySystemInspectorToolset::GetActiveTags. ASC.GetOwnedGameplayTags() -> container -> strings.
    The most likely-to-work GAS tool (single BlueprintCallable returning a tag container).
    """
    ai = json.dumps(actor)
    body = (
        _ASC
        + "try:\n"
        + "    actor, asc = _asc_for(" + ai + ")\n"
        + "    cont = asc.get_owned_gameplay_tags()\n"   # VERIFY: UAbilitySystemComponent.get_owned_gameplay_tags() -> FGameplayTagContainer exposure (good odds)
        + "    tags = sorted(str(t.to_string()) for t in cont.get_gameplay_tag_array())\n"   # VERIFY: get_gameplay_tag_array() exposure
        + "    _emit({'actor': " + ai + ", 'count': len(tags), 'tags': tags})\n"
        + "except SystemExit:\n"
        + "    pass\n"
        + "except Exception as e:\n"
        + "    _emit({'error': repr(e), 'hint': 'get_owned_gameplay_tags / tag-container iteration may not be Python-exposed'})\n"
    )
    return wrap(body)


def build_attribute_set_classes() -> str:
    """List all loaded AttributeSet subclasses and their attributes (project-wide, no actor needed).

    Mirrors UAttributeSetToolset::FindAttributeSetClasses. Iterates loaded UClasses via the engine's class
    iterator. In Python we approximate with get_default_object/asset enumeration - flagged.
    """
    body = (
        "try:\n"
        # VERIFY: there is no direct TObjectIterator<UClass> in Python. We enumerate Blueprint-derived AttributeSet
        # classes via the AssetRegistry and add the C++ base if reachable. Native C++ AttributeSet subclasses that
        # are NOT Blueprints won't show up here - that's a known gap vs the C++ tool.
        "    out = []\n"
        "    base = unreal.AttributeSet\n"
        "    ar = unreal.AssetRegistryHelpers.get_asset_registry()\n"
        "    f = unreal.ARFilter(class_names=['Blueprint'], recursive_classes=True, recursive_paths=True)\n"
        "    for ad in ar.get_assets(f):\n"
        "        try:\n"
        "            gc = ad.get_class()\n"
        "        except Exception:\n"
        "            gc = None\n"
        "        # cannot cheaply confirm parent==AttributeSet without loading; report candidate BP path only\n"
        "    _emit({'note': 'full AttributeSet class enumeration needs a UClass iterator not exposed to Python; '\n"
        "                   'use list_attributes(class_name) for a known set, or execute_python for a TObjectIterator',\n"
        "           'attribute_sets': out})\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_attribute_set_list(class_name) -> str:
    """List the attributes declared on a named AttributeSet class.

    Mirrors UAttributeSetToolset::ListAttributes. Resolves the UClass by name, then
    AttributeSet.get_attributes_from_set_class.
    """
    cn = json.dumps(class_name)
    body = (
        "try:\n"
        # VERIFY: resolving a UClass by short name from Python. unreal.load_class needs a path; we try the
        # /Script/<Module>.<Class> and Blueprint paths. If the set is a C++ class, the module path must be known.
        "    cls = None\n"
        "    name = " + cn + "\n"
        "    for path in ['/Script/GameplayAbilities.' + name, name]:\n"
        "        try:\n"
        "            cls = unreal.load_object(None, path)\n"   # VERIFY: load_object on a /Script path returning a UClass
        "        except Exception:\n"
        "            cls = None\n"
        "        if cls is not None:\n"
        "            break\n"
        "    if cls is None:\n"
        "        _emit({'error': 'AttributeSet class not found by name; pass a full /Script path via execute_python', 'class': name}); raise SystemExit\n"
        "    attrs = unreal.AttributeSet.get_attributes_from_set_class(cls)\n"   # VERIFY: as build_gas_attributes
        "    out = [{'attribute': a.get_name(), 'set': name, 'full_name': name + '.' + a.get_name()} for a in attrs]\n"
        "    _emit({'class': name, 'count': len(out), 'attributes': out})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'class-by-name resolution / get_attributes_from_set_class may not be Python-exposed'})\n"
    )
    return wrap(body)


# =====================================================================================================
# GameplayCue inspection  (mirror: GASToolsets/GameplayCueToolset - READ-ONLY subset; the cue-CREATE /
# AddCueTag / RemoveCueTag / ExecuteCue mutators are SKIPPED, see module footer)
# These lean on the AssetRegistry (well-exposed) + the tag manager (risky) - mixed risk.
# =====================================================================================================

def build_cue_list(parent_tag="") -> str:
    """List GameplayCue tags (descendants of 'GameplayCue', or of parent_tag).

    Mirrors UGameplayCueToolset::ListCues - same FGameplayTagNode-tree dependency as build_list_tags, so
    same risk. Defaults the root to 'GameplayCue'.
    """
    pt = json.dumps(parent_tag if parent_tag else "GameplayCue")
    body = (
        "try:\n"
        "    mgr = unreal.GameplayTagsManager.get()\n"            # VERIFY: GameplayTagsManager.get()
        "    node = mgr.find_tag_node(unreal.Name(" + pt + "))\n"  # VERIFY: find_tag_node + tag-node tree (likely NOT exposed)
        "    if node is None:\n"
        "        _emit({'error': 'root cue tag not found or tag-node tree not Python-exposed', 'parent': " + pt + "}); raise SystemExit\n"
        "    names = []; stack = list(node.get_child_tag_nodes())\n"
        "    while stack:\n"
        "        n = stack.pop(); names.append(str(n.get_complete_tag_name())); stack.extend(n.get_child_tag_nodes())\n"
        "    names = sorted(set(names))\n"
        "    _emit({'parent': " + pt + ", 'count': len(names), 'cues': names})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'cue tag-node tree may not be Python-exposed'})\n"
    )
    return wrap(body)


def build_cue_notify_assets(parent_tag="") -> str:
    """Find GameplayCueNotify assets (Static + Actor) and their cue tags, optionally filtered by parent tag.

    Mirrors UGameplayCueToolset::FindCueNotifyAssets. PURE AssetRegistry tag-value scan -> LOW risk; reads the
    'GameplayCueName' asset tag off each notify asset.
    """
    pt = json.dumps(parent_tag)
    body = (
        "try:\n"
        "    ar = unreal.AssetRegistryHelpers.get_asset_registry()\n"
        "    out = []\n"
        # VERIFY: GameplayCueNotify base class path names - GameplayCueNotify_Static (object) / GameplayCueNotify_Actor (actor).
        "    for cls, typ in [('GameplayCueNotify_Static', 'Static'), ('GameplayCueNotify_Actor', 'Actor')]:\n"
        "        f = unreal.ARFilter(class_names=[cls], recursive_classes=True, recursive_paths=True)\n"
        "        for ad in ar.get_assets(f):\n"
        "            cue = ad.get_tag_value('GameplayCueName')\n"   # VERIFY: AssetData.get_tag_value() exposure (good odds)
        "            if not cue:\n"
        "                continue\n"
        "            out.append({'cue_tag': str(cue), 'asset': str(ad.get_soft_object_path()), 'type': typ})\n"
        "    parent = " + pt + "\n"
        "    if parent:\n"
        "        out = [o for o in out if o['cue_tag'] == parent or o['cue_tag'].startswith(parent + '.')]\n"
        "    out.sort(key=lambda d: d['cue_tag'])\n"
        "    _emit({'parent': parent, 'count': len(out), 'notifies': out})\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_cue_info(cue_tag) -> str:
    """Info for one GameplayCue tag: the backing notify asset + its type (Static / Actor / None).

    Mirrors UGameplayCueToolset::GetCueInfo - AssetRegistry tag-value match on 'GameplayCueName'. LOW risk
    (no tag-node tree needed; we just scan notify assets for the tag).
    """
    ct = json.dumps(cue_tag)
    body = (
        "try:\n"
        "    ar = unreal.AssetRegistryHelpers.get_asset_registry()\n"
        "    found = {'tag': " + ct + ", 'notify_type': 'None'}\n"
        "    for cls, typ in [('GameplayCueNotify_Static', 'Static'), ('GameplayCueNotify_Actor', 'Actor')]:\n"
        "        f = unreal.ARFilter(class_names=[cls], recursive_classes=True, recursive_paths=True)\n"
        "        for ad in ar.get_assets(f):\n"
        "            if str(ad.get_tag_value('GameplayCueName')) == " + ct + ":\n"   # VERIFY: get_tag_value
        "                found['notify_asset'] = str(ad.get_soft_object_path()); found['notify_type'] = typ; break\n"
        "        if found['notify_type'] != 'None':\n"
        "            break\n"
        "    _emit(found)\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_cue_tags_without_notifies() -> str:
    """List cue tags that have NO backing notify asset (the 'unimplemented cue' report).

    Mirrors UGameplayCueToolset::FindCueTagsWithoutNotifies = ListCues minus FindCueNotifyAssets. Inherits the
    tag-node-tree risk from the ListCues half (the notify half is safe AssetRegistry).
    """
    body = (
        "try:\n"
        "    mgr = unreal.GameplayTagsManager.get()\n"            # VERIFY: GameplayTagsManager.get()
        "    node = mgr.find_tag_node(unreal.Name('GameplayCue'))\n"  # VERIFY: tag-node tree (likely NOT exposed)
        "    if node is None:\n"
        "        _emit({'error': 'GameplayCue root tag not found or tag-node tree not Python-exposed'}); raise SystemExit\n"
        "    cues = []; stack = list(node.get_child_tag_nodes())\n"
        "    while stack:\n"
        "        n = stack.pop(); cues.append(str(n.get_complete_tag_name())); stack.extend(n.get_child_tag_nodes())\n"
        "    ar = unreal.AssetRegistryHelpers.get_asset_registry()\n"
        "    have = set()\n"
        "    for cls in ['GameplayCueNotify_Static', 'GameplayCueNotify_Actor']:\n"
        "        f = unreal.ARFilter(class_names=[cls], recursive_classes=True, recursive_paths=True)\n"
        "        for ad in ar.get_assets(f):\n"
        "            cv = ad.get_tag_value('GameplayCueName')\n"
        "            if cv:\n"
        "                have.add(str(cv))\n"
        "    missing = sorted(t for t in set(cues) if t not in have)\n"
        "    _emit({'count': len(missing), 'cues_without_notifies': missing})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'cue tag-node tree may not be Python-exposed'})\n"
    )
    return wrap(body)


# =====================================================================================================
# GameFeatures  (mirror: GameFeaturesToolset - READ + light async-request subset)
# Backed by UGameFeaturesSubsystem (engine subsystem - good Python odds) + IPluginManager.
# RequestActivate/Deactivate are ASYNC and LIGHT (just submit a request) - included per the brief;
# they don't mutate assets, only load/activate plugins at runtime.
# =====================================================================================================

def build_gfp_list(discovered=False) -> str:
    """List Game Feature Plugins - enabled (default) or all discovered (discovered=True).

    Mirrors UGameFeaturesToolset::ListEnabled/ListDiscoveredGameFeaturePlugins.
    """
    which = "get_discovered_plugins" if discovered else "get_enabled_plugins"
    body = (
        "try:\n"
        "    gfs = unreal.GameFeaturesSubsystem.get()\n"          # VERIFY: UGameFeaturesSubsystem reflected + static .get(); else GEngine.get_engine_subsystem(unreal.GameFeaturesSubsystem)
        "    pm = unreal.PluginManager  # VERIFY: IPluginManager Python access - may need a different accessor\n"
        "    names = []\n"
        "    try:\n"
        "        plugins = unreal." + which.replace('get_', 'PluginBlueprintLibrary.get_') + "()\n"  # VERIFY: plugin enumeration accessor name is uncertain
        "    except Exception:\n"
        "        plugins = []\n"
        "    for p in plugins:\n"
        "        nm = getattr(p, 'name', None) or (p.get_name() if hasattr(p, 'get_name') else str(p))\n"
        "        try:\n"
        "            if gfs.is_game_feature_plugin(p):\n"   # VERIFY: is_game_feature_plugin signature (plugin obj vs name)
        "                names.append(str(nm))\n"
        "        except Exception:\n"
        "            names.append(str(nm))\n"
        "    _emit({'discovered': " + ("True" if discovered else "False") + ", 'count': len(sorted(set(names))), 'plugins': sorted(set(names))})\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'plugin enumeration accessor uncertain; if this fails use execute_python with IPluginManager'})\n"
    )
    return wrap(body)


def build_gfp_state(plugin_name) -> str:
    """Get a Game Feature Plugin's simplified state (Uninitialized/Installed/Registered/Loaded/Active/Unknown)
    plus an is_active flag.

    Mirrors UGameFeaturesToolset::GetGameFeatureState + IsGameFeatureActive.
    """
    pn = json.dumps(plugin_name)
    body = (
        "try:\n"
        "    gfs = unreal.GameFeaturesSubsystem.get()\n"          # VERIFY: as build_gfp_list
        "    name = " + pn + "\n"
        # VERIFY: GetPluginURLByName + GetPluginState are the C++ path. Python may instead expose a direct
        # get_game_feature_plugin_state(name)/is_game_feature_active(name) - we try the friendly names first.
        "    state = None; active = None\n"
        "    try:\n"
        "        active = bool(gfs.is_game_feature_active(name))\n"   # VERIFY: is_game_feature_active(name) exposure
        "    except Exception:\n"
        "        pass\n"
        "    try:\n"
        "        url = gfs.get_plugin_url_by_name(name)\n"   # VERIFY: get_plugin_url_by_name (out-param -> Python return) exposure
        "        state = str(gfs.get_plugin_state(url))\n"   # VERIFY: get_plugin_state(url) returns EGameFeaturePluginState enum
        "    except Exception:\n"
        "        pass\n"
        "    if state is None and active is None:\n"
        "        _emit({'error': 'GameFeaturesSubsystem state accessors not Python-exposed', 'plugin': name}); raise SystemExit\n"
        "    _emit({'plugin': name, 'state': state, 'is_active': active})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'GameFeaturesSubsystem may not expose state accessors to Python'})\n"
    )
    return wrap(body)


def build_gfp_request(plugin_name, activate=True) -> str:
    """Request ASYNC activate (default) or deactivate of a Game Feature Plugin. Returns immediately; poll
    gfp_state to confirm. LIGHT (no asset mutation) - mirrors RequestActivate/DeactivateGameFeature.
    """
    pn = json.dumps(plugin_name)
    fn = "load_and_activate_game_feature_plugin" if activate else "deactivate_game_feature_plugin"
    body = (
        "try:\n"
        "    gfs = unreal.GameFeaturesSubsystem.get()\n"          # VERIFY: as build_gfp_list
        "    name = " + pn + "\n"
        "    url = gfs.get_plugin_url_by_name(name)\n"   # VERIFY: get_plugin_url_by_name exposure
        # VERIFY: the load/deactivate calls take a completion DELEGATE in C++. Python may require omitting it or
        # passing None; if the binding demands the delegate this will error - acceptable (it's a request submit).
        "    gfs." + fn + "(url)\n"   # VERIFY: " + fn + " Python signature (delegate arg) uncertain
        "    _emit({'plugin': name, 'requested': " + ("'activate'" if activate else "'deactivate'") + ", 'submitted': True,\n"
        "           'note': 'async - poll gfp_state to confirm'})\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'activate/deactivate likely needs a completion delegate not easily passed from Python'})\n"
    )
    return wrap(body)


# =====================================================================================================
# DataRegistry  (mirror: DataRegistryToolset)
# Backed by UDataRegistrySubsystem (engine subsystem - good odds) but the per-item raw struct read is the
# riskiest single call in this whole module.
# =====================================================================================================

def build_registry_list() -> str:
    """List all registered Data Registries by name. Mirrors UDataRegistryTools::ListRegistries."""
    body = (
        "try:\n"
        "    sub = unreal.DataRegistrySubsystem.get()\n"   # VERIFY: UDataRegistrySubsystem static .get() exposure
        "    regs = sub.get_all_registries(True)\n"        # VERIFY: get_all_registries signature (bool param? out-array vs return)
        "    names = sorted(str(r.get_registry_type()) for r in regs if r is not None)\n"   # VERIFY: UDataRegistry.get_registry_type() exposure
        "    _emit({'count': len(names), 'registries': names})\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'DataRegistrySubsystem / get_all_registries may not be Python-exposed'})\n"
    )
    return wrap(body)


def build_registry_info(registry_name) -> str:
    """Info for one Data Registry: description, item struct, item count, availability, id format.

    Mirrors UDataRegistryTools::GetRegistryInfo.
    """
    rn = json.dumps(registry_name)
    body = (
        "try:\n"
        "    sub = unreal.DataRegistrySubsystem.get()\n"   # VERIFY: as build_registry_list
        "    reg = sub.get_registry_for_type(unreal.Name(" + rn + "))\n"   # VERIFY: get_registry_for_type(FName)->UDataRegistry exposure
        "    if reg is None:\n"
        "        _emit({'error': 'registry not found', 'registry': " + rn + "}); raise SystemExit\n"
        "    info = {'registry': " + rn + "}\n"
        "    try:\n"
        "        st = reg.get_item_struct(); info['item_struct'] = st.get_name() if st is not None else None\n"   # VERIFY: get_item_struct()
        "    except Exception:\n"
        "        pass\n"
        "    try:\n"
        "        ids = reg.get_possible_registry_ids()\n"   # VERIFY: get_possible_registry_ids() (out-array vs return)
        "        info['item_count'] = len(ids)\n"
        "    except Exception:\n"
        "        pass\n"
        "    try:\n"
        "        info['description'] = str(reg.get_registry_description())\n"   # VERIFY: get_registry_description()
        "    except Exception:\n"
        "        pass\n"
        "    _emit(info)\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_registry_schema(registry_name) -> str:
    """Get a Data Registry's item-struct schema (field names + types).

    Mirrors UDataRegistryTools::GetSchema. The C++ uses UToolsetLibrary::ListStructProperties (toolset-internal,
    NOT available to us) - here we reflect the struct's properties directly via Python.
    """
    rn = json.dumps(registry_name)
    body = (
        "try:\n"
        "    sub = unreal.DataRegistrySubsystem.get()\n"   # VERIFY: as build_registry_list
        "    reg = sub.get_registry_for_type(unreal.Name(" + rn + "))\n"   # VERIFY: get_registry_for_type
        "    if reg is None:\n"
        "        _emit({'error': 'registry not found', 'registry': " + rn + "}); raise SystemExit\n"
        "    st = reg.get_item_struct()\n"
        "    if st is None:\n"
        "        _emit({'error': 'registry has no item struct', 'registry': " + rn + "}); raise SystemExit\n"
        # VERIFY: enumerating a UScriptStruct's properties from Python is not cleanly exposed (no public
        # property-iterator binding). We report the struct path; full field listing needs execute_python.
        "    _emit({'registry': " + rn + ", 'item_struct': st.get_name(),\n"
        "           'item_struct_path': st.get_path_name(),\n"
        "           'note': 'per-field schema needs UStruct property iteration not exposed to Python; '\n"
        "                   'use execute_python or inspect the struct path'})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_registry_items(registry_name) -> str:
    """List all item NAMES in a Data Registry. Mirrors UDataRegistryTools::ListItems."""
    rn = json.dumps(registry_name)
    body = (
        "try:\n"
        "    sub = unreal.DataRegistrySubsystem.get()\n"   # VERIFY: as build_registry_list
        "    reg = sub.get_registry_for_type(unreal.Name(" + rn + "))\n"   # VERIFY: get_registry_for_type
        "    if reg is None:\n"
        "        _emit({'error': 'registry not found', 'registry': " + rn + "}); raise SystemExit\n"
        "    ids = reg.get_possible_registry_ids()\n"   # VERIFY: get_possible_registry_ids
        "    names = [str(i.item_name) for i in ids]\n"   # VERIFY: FDataRegistryId.item_name property exposure
        "    _emit({'registry': " + rn + ", 'count': len(names), 'items': names})\n"
        "except SystemExit:\n"
        "    pass\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_registry_get_items(registry_name, item_names) -> str:
    """Fetch CACHED item data for named registry items (only items already loaded into the cache return).

    Mirrors UDataRegistryTools::GetItems. HIGHEST-RISK call in the module: the C++ uses GetCachedItemRaw
    (raw struct memory) which is NOT Python-callable. We attempt the BlueprintCallable
    AcquireItem/get_cached_item path and degrade gracefully.
    """
    rn = json.dumps(registry_name)
    names_json = json.dumps(list(item_names))
    body = (
        "try:\n"
        "    sub = unreal.DataRegistrySubsystem.get()\n"   # VERIFY: as build_registry_list
        "    names = " + names_json + "\n"
        "    out = {}\n"
        "    for nm in names:\n"
        "        rid = unreal.DataRegistryId()\n"   # VERIFY: FDataRegistryId construction + field set from Python
        "        try:\n"
        "            rid.registry_type = unreal.Name(" + rn + "); rid.item_name = unreal.Name(nm)\n"
        "        except Exception:\n"
        "            pass\n"
        # VERIFY: there is NO Python-friendly raw-struct getter. get_cached_item_bp / find_cached_item return
        # an FInstancedStruct or a generic struct wrapper at best; whole-call success is doubtful.
        "        try:\n"
        "            res = unreal.DataRegistrySubsystem.get_cached_item_bp(rid)\n"   # VERIFY: this BP helper name/signature is a GUESS
        "            out[nm] = str(res)\n"
        "        except Exception as ie:\n"
        "            out[nm] = {'error': repr(ie)}\n"
        "    _emit({'registry': " + rn + ", 'items': out,\n"
        "           'note': 'cached-only; raw struct read is largely C++-only - expect partial/None data via Python'})\n"
        "except Exception as e:\n"
        "    _emit({'error': repr(e), 'hint': 'GetItems is the riskiest binding; likely needs execute_python or C++'})\n"
    )
    return wrap(body)


# =====================================================================================================
# Behavior Tree  (mirror: AIModuleToolset/behavior_tree.py)
# THE ONLY sub-domain proven against shipped engine Python: AIModuleToolset ships these tools AS Python,
# using exactly unreal.BehaviorTree / unreal.BTCompositeNode / get_blackboard_asset() / root_node /
# children / child_composite / child_task. LOW risk - mirrored 1:1 from the engine's own code.
# All take a BT ASSET PATH (we load_asset it), since these inspect an asset, not a level actor.
# =====================================================================================================

# Helper compiled into BT snippets: load the BT asset by path, error+SystemExit if missing/wrong type.
_BT = (
    "def _load_bt(path):\n"
    "    bt = unreal.load_asset(path)\n"
    "    if bt is None:\n"
    "        _emit({'error': 'behavior tree asset not found', 'path': path}); raise SystemExit\n"
    "    if not isinstance(bt, unreal.BehaviorTree):\n"
    "        _emit({'error': 'asset is not a BehaviorTree', 'path': path, 'class': bt.get_class().get_name()}); raise SystemExit\n"
    "    return bt\n"
    "def _bt_walk(comp, depth, nodes, depths):\n"
    "    nodes.append(comp); depths.append(depth)\n"
    "    for s in comp.services:\n"
    "        nodes.append(s); depths.append(depth + 1)\n"
    "    for child in comp.children:\n"
    "        for d in child.decorators:\n"
    "            nodes.append(d); depths.append(depth + 1)\n"
    "        node = child.child_composite or child.child_task\n"
    "        if node is None:\n"
    "            continue\n"
    "        if isinstance(node, unreal.BTCompositeNode):\n"
    "            _bt_walk(node, depth + 1, nodes, depths)\n"
    "        else:\n"
    "            nodes.append(node); depths.append(depth + 1)\n"
)


def build_bt_blackboard(bt_path) -> str:
    """Get the BlackboardData asset (and its keys) for a Behavior Tree.

    Mirrors AIModuleToolset BehaviorTreeTools.get_blackboard - bt.get_blackboard_asset(). PROVEN Python API.
    """
    p = json.dumps(bt_path)
    body = (
        _BT
        + "try:\n"
        + "    bt = _load_bt(" + p + ")\n"
        + "    bb = bt.get_blackboard_asset()\n"   # proven (engine ships this exact call in Python)
        + "    out = {'behavior_tree': " + p + ", 'blackboard': bb.get_path_name() if bb is not None else None}\n"
        + "    keys = []\n"
        + "    if bb is not None:\n"
        + "        try:\n"
        + "            for k in bb.keys:\n"   # VERIFY: BlackboardData.keys (entry name/type) field exposure - bonus detail, safe-guarded
        + "                kn = getattr(k, 'entry_name', None)\n"
        + "                keys.append(str(kn) if kn is not None else str(k))\n"
        + "        except Exception:\n"
        + "            pass\n"
        + "    out['keys'] = keys\n"
        + "    _emit(out)\n"
        + "except SystemExit:\n"
        + "    pass\n"
        + "except Exception as e:\n"
        + "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_bt_list_nodes(bt_path) -> str:
    """Flat list of all nodes in a Behavior Tree (tree order) with class name + depth.

    Mirrors AIModuleToolset BehaviorTreeTools.list_nodes + get_node_depths. PROVEN Python API.
    """
    p = json.dumps(bt_path)
    body = (
        _BT
        + "try:\n"
        + "    bt = _load_bt(" + p + ")\n"
        + "    nodes = []; depths = []\n"
        + "    root = bt.root_node\n"   # proven
        + "    if root is None:\n"
        + "        _emit({'behavior_tree': " + p + ", 'count': 0, 'nodes': [], 'note': 'tree has no root node'}); raise SystemExit\n"
        + "    for dec in bt.root_decorators:\n"   # proven
        + "        nodes.append(dec); depths.append(0)\n"
        + "    _bt_walk(root, 0, nodes, depths)\n"
        + "    out = [{'index': i, 'class': n.get_class().get_name(), 'name': n.get_name(), 'depth': depths[i]}\n"
        + "           for i, n in enumerate(nodes)]\n"
        + "    _emit({'behavior_tree': " + p + ", 'count': len(out), 'nodes': out})\n"
        + "except SystemExit:\n"
        + "    pass\n"
        + "except Exception as e:\n"
        + "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)


def build_bt_children(bt_path, node_index) -> str:
    """Direct child nodes of one composite node (by its list_nodes index) in a Behavior Tree.

    Mirrors AIModuleToolset BehaviorTreeTools.get_children. PROVEN Python API. Resolves the composite by the
    same tree-order index that bt_list_nodes reports.
    """
    p = json.dumps(bt_path)
    idx = int(node_index)
    body = (
        _BT
        + "try:\n"
        + "    bt = _load_bt(" + p + ")\n"
        + "    nodes = []; depths = []\n"
        + "    root = bt.root_node\n"
        + "    if root is None:\n"
        + "        _emit({'error': 'tree has no root node', 'behavior_tree': " + p + "}); raise SystemExit\n"
        + "    for dec in bt.root_decorators:\n"
        + "        nodes.append(dec); depths.append(0)\n"
        + "    _bt_walk(root, 0, nodes, depths)\n"
        + "    i = " + str(idx) + "\n"
        + "    if not (0 <= i < len(nodes)):\n"
        + "        _emit({'error': 'node_index out of range', 'index': i, 'node_count': len(nodes)}); raise SystemExit\n"
        + "    comp = nodes[i]\n"
        + "    if not isinstance(comp, unreal.BTCompositeNode):\n"
        + "        _emit({'error': 'node at index is not a composite (no children)', 'index': i,\n"
        + "               'class': comp.get_class().get_name()}); raise SystemExit\n"
        + "    kids = []\n"
        + "    for child in comp.children:\n"
        + "        node = child.child_composite or child.child_task\n"
        + "        if node is not None:\n"
        + "            kids.append({'class': node.get_class().get_name(), 'name': node.get_name()})\n"
        + "    _emit({'behavior_tree': " + p + ", 'node_index': i, 'composite': comp.get_class().get_name(),\n"
        + "           'child_count': len(kids), 'children': kids})\n"
        + "except SystemExit:\n"
        + "    pass\n"
        + "except Exception as e:\n"
        + "    _emit({'error': repr(e)})\n"
    )
    return wrap(body)
