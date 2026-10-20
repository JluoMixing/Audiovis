"""诊断：现有 _鼓组步进器 的完整结构，为改造做准备。"""
import pathlib

p = pathlib.Path(r"D:\FL_VISUAL_TEST\src\audio\analyze.py")
s = p.read_text(encoding="utf-8")

i = s.find("def _鼓组步进器")
j = s.find("\ndef _鼓组使用", i)
print("=== _鼓组步进器 全文（%d 字符）===" % (j - i))
print(s[i:j])

print()
print("=== 相关辅助函数 ===")
for name in ["_midi", "_鼓组分类"]:
    k = s.find("def " + name)
    if k > 0:
        e = s.find("\ndef ", k + 1)
        print("--- %s ---" % name)
        print(s[k:min(e, k + 700)])
        print()
