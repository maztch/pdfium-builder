#include <memory>

#include "core/fxge/cfx_folderfontinfo.h"
#include "core/fxge/cfx_gemodule.h"

namespace {

class WasmPlatform final : public CFX_GEModule::PlatformIface {
 public:
  void Init() override {}
  void Terminate() override {}

  std::unique_ptr<SystemFontInfoIface> CreateDefaultSystemFontInfo() override {
    return std::make_unique<CFX_FolderFontInfo>();
  }
};

}  // namespace

std::unique_ptr<CFX_GEModule::PlatformIface> CFX_GEModule::PlatformIface::Create() {
  return std::make_unique<WasmPlatform>();
}
