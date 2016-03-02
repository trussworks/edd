from __future__ import division
from .util import RawImportRecord

def float_or_none (val) :
  try :
    return float(val)
  except ValueError :
    return None

def int_or_none (val) :
  try :
    return int(val)
  except ValueError :
    return None
