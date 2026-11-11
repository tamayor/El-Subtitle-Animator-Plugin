"""A stand-in for Blackmagic's DaVinciResolveScript module, so fusion_bridge.py can be imported and run without
DaVinci Resolve. Tests put a fake Resolve object in RESOLVE; scriptapp() hands it out the way the real module does
(None when Resolve cannot be reached)."""

RESOLVE = None
CALLS = {"scriptapp": 0}


def scriptapp(name):
    CALLS["scriptapp"] += 1
    return RESOLVE if name == "Resolve" else None


class Counted(object):
    """Counts the calls made to each method (obj.calls["GetAttrs"])."""

    def __init__(self):
        self.calls = {}

    def _hit(self, name):
        self.calls[name] = self.calls.get(name, 0) + 1


class Tool(Counted):
    def __init__(self, name, reg_id, inputs=None):
        Counted.__init__(self)
        self.name, self.reg_id, self.inputs = name, reg_id, dict(inputs or {})

    def GetAttrs(self):
        self._hit("GetAttrs")
        return {"TOOLS_Name": self.name, "TOOLS_RegID": self.reg_id}

    def GetInput(self, key, time=None):
        self._hit("GetInput")
        return self.inputs.get(key)

    def SetInput(self, key, value, time=None):
        self._hit("SetInput")
        self.inputs[key] = value


class Comp(Counted):
    def __init__(self, tools):
        Counted.__init__(self)
        self.tools = list(tools)

    def GetToolList(self, selected=False):
        self._hit("GetToolList")
        return dict((float(i + 1), t) for i, t in enumerate(self.tools))      # a Lua table arrives as a dict


class Item(Counted):
    def __init__(self, uid, name="Text+ Pop", comps=None):
        Counted.__init__(self)
        self.uid, self.name, self.comps = uid, name, list(comps or [])

    def GetUniqueId(self):
        self._hit("GetUniqueId")
        return self.uid

    def GetName(self):
        return self.name

    def GetFusionCompCount(self):
        return len(self.comps)

    def GetFusionCompByIndex(self, i):
        return self.comps[i - 1] if 1 <= i <= len(self.comps) else None

    def GetFusionCompByName(self, name):
        return None


class Timeline(Counted):
    def __init__(self, video_tracks):
        Counted.__init__(self)
        self.video = [list(t) for t in video_tracks]

    def GetTrackCount(self, kind):
        return len(self.video) if kind == "video" else 0

    def GetItemListInTrack(self, kind, t):
        self._hit("GetItemListInTrack")
        if kind != "video" or not (1 <= t <= len(self.video)):
            return None
        return list(self.video[t - 1])


class Project(object):
    def __init__(self, timeline):
        self.timeline = timeline

    def GetCurrentTimeline(self):
        return self.timeline


class ProjectManager(object):
    def __init__(self, project):
        self.project = project

    def GetCurrentProject(self):
        return self.project


class Resolve(object):
    def __init__(self, timeline=None, project="default"):
        self.pm = ProjectManager(Project(timeline) if project == "default" else project)

    def GetProjectManager(self):
        return self.pm
