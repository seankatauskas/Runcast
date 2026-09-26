package expo.modules.mutationstorage

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class MutationStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MutationStorage")

    AsyncFunction("directory") {
      val context = requireNotNull(appContext.reactContext) { "React context unavailable" }
      val directory = File(context.noBackupFilesDir, "RuncastMutations")
      check(directory.isDirectory || directory.mkdirs()) { "Cannot create mutation storage" }
      directory.toURI().toString()
    }
  }
}
