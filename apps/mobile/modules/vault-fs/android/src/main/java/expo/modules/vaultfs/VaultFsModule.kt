package expo.modules.vaultfs

import android.content.Intent
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Pont Expo Modules : toutes les fonctions sont des AsyncFunction (exécutées
// sur la file du module, JAMAIS sur le thread UI).
class VaultFsModule : Module() {
  private val resolver get() = appContext.reactContext?.contentResolver
    ?: throw CodedException("E_NO_CONTEXT", "Contexte Android indisponible", null)

  private fun core() = VaultFsCore(resolver)

  private fun tree(treeUri: String): Uri {
    if (!treeUri.startsWith("content://") || !treeUri.contains("/tree/")) {
      throw CodedException("E_NOT_TREE", "URI d'arbre SAF attendue (content://…/tree/…), reçu : $treeUri", null)
    }
    return Uri.parse(treeUri)
  }

  private fun <T> guard(block: () -> T): T = try {
    block()
  } catch (e: VaultFsException) {
    throw CodedException(e.code, e.message ?: e.code, e)
  } catch (e: SecurityException) {
    throw CodedException("E_PERMISSION", "Permission SAF absente ou révoquée : ${e.message}", e)
  }

  private fun encode(bytes: ByteArray, encoding: String): String =
    if (encoding == "base64") Base64.encodeToString(bytes, Base64.NO_WRAP) else String(bytes, Charsets.UTF_8)

  private fun decode(content: String, encoding: String): ByteArray =
    if (encoding == "base64") Base64.decode(content, Base64.DEFAULT) else content.toByteArray(Charsets.UTF_8)

  override fun definition() = ModuleDefinition {
    Name("VaultFs")

    AsyncFunction("hasPermission") { treeUri: String ->
      val uri = tree(treeUri)
      resolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission && it.isWritePermission }
    }

    AsyncFunction("takePersistablePermission") { treeUri: String ->
      guard {
        resolver.takePersistableUriPermission(
          tree(treeUri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        true
      }
    }

    AsyncFunction("listTree") { treeUri: String ->
      guard {
        val (entries, errors) = core().listTree(tree(treeUri))
        mapOf(
          "entries" to entries.map {
            mapOf("relPath" to it.relPath, "docId" to it.docId, "isDirectory" to it.isDir, "mtime" to it.mtime.toDouble(), "size" to it.size.toDouble())
          },
          "errors" to errors.map { mapOf("relPath" to it.relPath, "message" to it.message) },
        )
      }
    }

    AsyncFunction("stat") { treeUri: String, relPath: String ->
      guard {
        core().resolve(tree(treeUri), relPath)?.let {
          mapOf("docId" to it.docId, "name" to it.name, "isDirectory" to it.isDir, "mtime" to it.mtime.toDouble(), "size" to it.size.toDouble())
        }
      }
    }

    AsyncFunction("readFile") { treeUri: String, relPath: String, encoding: String ->
      guard {
        val (child, bytes) = core().readFile(tree(treeUri), relPath)
        mapOf(
          "content" to encode(bytes, encoding),
          "size" to bytes.size.toDouble(),
          "sha256" to VaultFsCore.sha256Hex(bytes),
          "mtime" to child.mtime.toDouble(),
          "docId" to child.docId,
        )
      }
    }

    AsyncFunction("writeFileAtomic") { treeUri: String, relPath: String, content: String, encoding: String ->
      guard {
        val r = core().writeFileAtomic(tree(treeUri), relPath, decode(content, encoding))
        mapOf("relPath" to r.relPath, "docId" to r.docId, "size" to r.size.toDouble(), "sha256" to r.sha256, "method" to r.method)
      }
    }

    AsyncFunction("mkdirs") { treeUri: String, relPath: String ->
      guard { core().mkdirs(tree(treeUri), relPath) }
    }

    AsyncFunction("deleteFile") { treeUri: String, relPath: String, permanent: Boolean ->
      guard {
        val stamp = SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss", Locale.ROOT).format(Date())
        mapOf("trashRelPath" to core().deleteFile(tree(treeUri), relPath, permanent, stamp))
      }
    }

    AsyncFunction("rename") { treeUri: String, relPath: String, newName: String ->
      guard { core().rename(tree(treeUri), relPath, newName) }
    }

    AsyncFunction("move") { treeUri: String, relPath: String, destParentRelPath: String ->
      guard { core().move(tree(treeUri), relPath, destParentRelPath) }
    }
  }
}
