import ExpoModulesCore
import Foundation

public class MutationStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MutationStorage")

    AsyncFunction("directory") { () throws -> String in
      let manager = FileManager.default
      let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
      var directory = support.appendingPathComponent("RuncastMutations", isDirectory: true)
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
      return directory.absoluteString
    }
  }
}
