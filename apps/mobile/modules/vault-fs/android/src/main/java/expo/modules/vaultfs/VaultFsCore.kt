package expo.modules.vaultfs

import android.content.ContentResolver
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.text.Normalizer
import java.util.UUID

// ✒️ 123ECRITURE — VaultFsCore.kt — le SEUL point d'accès fichiers Android du coffre
//
// Invariants :
//   • On ne manipule QUE l'URI d'arbre persistante (content://…/tree/…) et des
//     document IDs, via DocumentsContract.build*UsingTree. Jamais de file://,
//     jamais de nom déduit d'une URI : le nom vient TOUJOURS de DISPLAY_NAME.
//   • Un dossier est un dossier parce que MIME_TYPE == Document.MIME_TYPE_DIR,
//     jamais parce qu'une lecture a échoué.
//   • Un dossier illisible est remonté dans `errors` : ses enfants sont
//     « inconnus », pas absents (l'appelant ne doit RIEN supprimer dessous).
//   • Une écriture n'est un succès qu'après relecture : taille + SHA-256 +
//     nom final identiques à ce qui était demandé.
//   • Aucune suppression directe par défaut : delete = déplacement dans .trash/.

class VaultFsException(val code: String, message: String) : Exception(message)

data class Child(val docId: String, val name: String, val mime: String, val mtime: Long, val size: Long) {
  val isDir: Boolean get() = mime == Document.MIME_TYPE_DIR
}

data class TreeEntry(val relPath: String, val docId: String, val isDir: Boolean, val mtime: Long, val size: Long)
data class TreeError(val relPath: String, val message: String)
data class WriteResult(val relPath: String, val docId: String, val size: Long, val sha256: String, val method: String)

class VaultFsCore(private val resolver: ContentResolver) {

  companion object {
    const val TRASH_DIR = ".trash"
    const val MAX_DEPTH = 64
    private val PROJECTION = arrayOf(
      Document.COLUMN_DOCUMENT_ID,
      Document.COLUMN_DISPLAY_NAME,
      Document.COLUMN_MIME_TYPE,
      Document.COLUMN_LAST_MODIFIED,
      Document.COLUMN_SIZE,
    )

    // relPath POSIX normalisé : `\` → `/`, segments vides et `.` retirés, `..` refusé, NFC.
    fun normalizeRelPath(relPath: String): String {
      val nfc = Normalizer.normalize(relPath.replace('\\', '/'), Normalizer.Form.NFC)
      val segments = nfc.split('/').filter { it.isNotEmpty() && it != "." }
      if (segments.any { it == ".." }) throw VaultFsException("E_PATH", "Chemin invalide (..) : $relPath")
      return segments.joinToString("/")
    }

    fun segmentsOf(relPath: String): List<String> =
      normalizeRelPath(relPath).let { if (it.isEmpty()) emptyList() else it.split('/') }

    fun sha256Hex(bytes: ByteArray): String =
      MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    // MIME demandé à la création = celui que résout l'extension (sinon Android 11+
    // AJOUTE une extension : « .md » → « .md.txt »). Même règle que mimeForName (TS).
    fun mimeForName(name: String): String {
      val lower = name.lowercase()
      return when {
        lower.endsWith(".md") -> "text/markdown"
        lower.endsWith(".json") -> "application/json"
        lower.endsWith(".txt") -> "text/plain"
        lower.endsWith(".png") -> "image/png"
        lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
        lower.endsWith(".gif") -> "image/gif"
        lower.endsWith(".webp") -> "image/webp"
        lower.endsWith(".pdf") -> "application/pdf"
        else -> "application/octet-stream"
      }
    }

    fun sameName(a: String, b: String): Boolean =
      Normalizer.normalize(a, Normalizer.Form.NFC) == Normalizer.normalize(b, Normalizer.Form.NFC)
  }

  // ---------- requêtes de base ----------

  fun rootDocId(treeUri: Uri): String = DocumentsContract.getTreeDocumentId(treeUri)

  fun docUri(treeUri: Uri, docId: String): Uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)

  // UNE requête ContentResolver par dossier (batch des colonnes utiles).
  fun listChildren(treeUri: Uri, parentDocId: String): List<Child> {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)
    val cursor: Cursor = resolver.query(childrenUri, PROJECTION, null, null, null)
      ?: throw VaultFsException("E_LIST", "Le fournisseur n'a rien renvoyé pour ce dossier")
    val out = ArrayList<Child>()
    cursor.use { c ->
      while (c.moveToNext()) {
        val docId = c.getString(0) ?: continue
        val name = c.getString(1) ?: continue
        val mime = c.getString(2) ?: "application/octet-stream"
        val mtime = if (c.isNull(3)) 0L else c.getLong(3)
        val size = if (c.isNull(4)) 0L else c.getLong(4)
        out.add(Child(docId, name, mime, mtime, size))
      }
    }
    return out
  }

  fun queryOne(treeUri: Uri, docId: String): Child? {
    val cursor = resolver.query(docUri(treeUri, docId), PROJECTION, null, null, null) ?: return null
    cursor.use { c ->
      if (!c.moveToFirst()) return null
      return Child(
        c.getString(0) ?: docId,
        c.getString(1) ?: "",
        c.getString(2) ?: "application/octet-stream",
        if (c.isNull(3)) 0L else c.getLong(3),
        if (c.isNull(4)) 0L else c.getLong(4),
      )
    }
  }

  fun findChild(treeUri: Uri, parentDocId: String, name: String): Child? =
    listChildren(treeUri, parentDocId).firstOrNull { sameName(it.name, name) }

  // Résout un relPath par noms EXACTS depuis la racine. null si absent.
  fun resolve(treeUri: Uri, relPath: String): Child? {
    var current = rootDocId(treeUri)
    var last: Child? = null
    for (segment in segmentsOf(relPath)) {
      val child = findChild(treeUri, current, segment) ?: return null
      last = child
      current = child.docId
    }
    return last ?: queryOne(treeUri, current)
  }

  // ---------- listTree ----------

  fun listTree(treeUri: Uri): Pair<List<TreeEntry>, List<TreeError>> {
    val entries = ArrayList<TreeEntry>()
    val errors = ArrayList<TreeError>()
    val queue = ArrayDeque<Triple<String, String, Int>>()
    queue.add(Triple(rootDocId(treeUri), "", 0))
    while (queue.isNotEmpty()) {
      val (docId, rel, depth) = queue.removeFirst()
      if (depth > MAX_DEPTH) {
        errors.add(TreeError(rel, "Profondeur maximale atteinte"))
        continue
      }
      val children = try {
        listChildren(treeUri, docId)
      } catch (e: Exception) {
        errors.add(TreeError(rel, e.message ?: e.javaClass.simpleName))
        continue
      }
      for (child in children) {
        val childRel = if (rel.isEmpty()) child.name else "$rel/${child.name}"
        val normalized = Normalizer.normalize(childRel, Normalizer.Form.NFC)
        entries.add(TreeEntry(normalized, child.docId, child.isDir, child.mtime, child.size))
        if (child.isDir) queue.add(Triple(child.docId, normalized, depth + 1))
      }
    }
    return entries to errors
  }

  // ---------- lecture ----------

  fun readBytes(treeUri: Uri, docId: String): ByteArray {
    val stream = resolver.openInputStream(docUri(treeUri, docId))
      ?: throw VaultFsException("E_READ", "Impossible d'ouvrir le document en lecture")
    return stream.use { input ->
      val buffer = ByteArrayOutputStream()
      input.copyTo(buffer)
      buffer.toByteArray()
    }
  }

  fun readFile(treeUri: Uri, relPath: String): Pair<Child, ByteArray> {
    val child = resolve(treeUri, relPath) ?: throw VaultFsException("E_NOT_FOUND", "Introuvable : $relPath")
    if (child.isDir) throw VaultFsException("E_IS_DIR", "« $relPath » est un dossier")
    return child to readBytes(treeUri, child.docId)
  }

  // ---------- dossiers ----------

  // Crée les dossiers manquants — cherche TOUJOURS d'abord par nom exact
  // (jamais de doublon « (1) »). Renvoie le docId du dernier dossier.
  fun mkdirs(treeUri: Uri, relPath: String): String {
    var current = rootDocId(treeUri)
    for (segment in segmentsOf(relPath)) {
      val existing = findChild(treeUri, current, segment)
      if (existing != null) {
        if (!existing.isDir) throw VaultFsException("E_NOT_DIR", "« $segment » existe déjà et n'est pas un dossier")
        current = existing.docId
        continue
      }
      val created = DocumentsContract.createDocument(resolver, docUri(treeUri, current), Document.MIME_TYPE_DIR, segment)
        ?: throw VaultFsException("E_MKDIR", "Création du dossier « $segment » refusée")
      val info = queryOne(treeUri, DocumentsContract.getDocumentId(created))
      if (info == null || !sameName(info.name, segment)) {
        // Le fournisseur a renommé (caractère interdit, doublon) : on n'invente pas d'arbre faux.
        throw VaultFsException("E_NAME", "Nom de dossier non représentable sur cet appareil : « $segment » (obtenu « ${info?.name} »)")
      }
      current = info.docId
    }
    return current
  }

  // ---------- écriture atomique ----------

  private fun writeInto(treeUri: Uri, docId: String, bytes: ByteArray) {
    // 'wt' = write + TRUNCATE : jamais de queue d'ancien contenu.
    val stream = resolver.openOutputStream(docUri(treeUri, docId), "wt")
      ?: throw VaultFsException("E_WRITE", "Impossible d'ouvrir le document en écriture")
    stream.use { it.write(bytes); it.flush() }
  }

  private fun verify(treeUri: Uri, docId: String, expected: ByteArray, expectedHash: String) {
    val back = readBytes(treeUri, docId)
    if (back.size != expected.size || sha256Hex(back) != expectedHash) {
      throw VaultFsException("E_VERIFY", "Vérification échouée : ${back.size} octets relus pour ${expected.size} attendus")
    }
  }

  private fun tryRename(treeUri: Uri, docId: String, newName: String): String? = try {
    DocumentsContract.renameDocument(resolver, docUri(treeUri, docId), newName)?.let { DocumentsContract.getDocumentId(it) }
      ?: docId // null = renommé sur place, docId inchangé
  } catch (e: Exception) {
    null
  }

  private fun tryDelete(treeUri: Uri, docId: String) {
    try { DocumentsContract.deleteDocument(resolver, docUri(treeUri, docId)) } catch (_: Exception) {}
  }

  fun writeFileAtomic(treeUri: Uri, relPath: String, bytes: ByteArray): WriteResult {
    val segments = segmentsOf(relPath)
    if (segments.isEmpty()) throw VaultFsException("E_PATH", "Chemin vide")
    val name = segments.last()
    val parentRel = segments.dropLast(1).joinToString("/")
    val norm = segments.joinToString("/")
    val parentId = mkdirs(treeUri, parentRel)
    val hash = sha256Hex(bytes)
    val existing = findChild(treeUri, parentId, name)
    if (existing != null && existing.isDir) throw VaultFsException("E_IS_DIR", "« $relPath » est un dossier")

    // 1) fichier temporaire caché, même extension que la cible (pas d'ajout d'extension par Android)
    val tmpName = ".vfs-${UUID.randomUUID().toString().take(8)}-$name"
    val tmpUri = DocumentsContract.createDocument(resolver, docUri(treeUri, parentId), mimeForName(name), tmpName)
    if (tmpUri != null) {
      var tmpId = DocumentsContract.getDocumentId(tmpUri)
      var asideId: String? = null
      try {
        writeInto(treeUri, tmpId, bytes)
        verify(treeUri, tmpId, bytes, hash)
        // 2) mettre l'ancien de côté (renameDocument refuse/numérote un nom déjà pris)
        if (existing != null) {
          asideId = tryRename(treeUri, existing.docId, ".vfs-old-${UUID.randomUUID().toString().take(8)}-$name")
        }
        if (existing == null || asideId != null) {
          val renamedId = tryRename(treeUri, tmpId, name)
          val info = renamedId?.let { queryOne(treeUri, it) }
          if (renamedId != null && info != null && sameName(info.name, name)) {
            verify(treeUri, renamedId, bytes, hash)
            if (asideId != null) tryDelete(treeUri, asideId)
            return WriteResult(norm, renamedId, bytes.size.toLong(), hash, "rename")
          }
          // Échec du renommage : on remet l'ancien en place, puis repli direct.
          if (renamedId != null) tmpId = renamedId
          if (asideId != null) { tryRename(treeUri, asideId, name); asideId = null }
        }
      } catch (e: Exception) {
        // L'ancien contenu ne reste JAMAIS de côté : on le remet à son nom.
        if (asideId != null) { tryRename(treeUri, asideId, name); asideId = null }
        if (e is VaultFsException && e.code != "E_VERIFY") { tryDelete(treeUri, tmpId); throw e }
        // fournisseur sans renameDocument, vérif du temporaire ratée… → repli direct
      }
      tryDelete(treeUri, tmpId)
    }

    // 3) REPLI : écriture directe 'wt' + vérification.
    val target = findChild(treeUri, parentId, name) ?: run {
      val created = DocumentsContract.createDocument(resolver, docUri(treeUri, parentId), mimeForName(name), name)
        ?: throw VaultFsException("E_CREATE", "Création refusée : $relPath")
      queryOne(treeUri, DocumentsContract.getDocumentId(created))
        ?: throw VaultFsException("E_CREATE", "Document créé introuvable : $relPath")
    }
    if (!sameName(target.name, name)) {
      tryDelete(treeUri, target.docId)
      throw VaultFsException("E_NAME", "Nom non représentable sur cet appareil : « $name » (obtenu « ${target.name} »)")
    }
    writeInto(treeUri, target.docId, bytes)
    verify(treeUri, target.docId, bytes, hash)
    return WriteResult(norm, target.docId, bytes.size.toLong(), hash, "direct")
  }

  // ---------- corbeille, renommage, déplacement ----------

  fun moveDoc(treeUri: Uri, src: Child, srcParentId: String, destParentId: String): String {
    val moved = DocumentsContract.moveDocument(resolver, docUri(treeUri, src.docId), docUri(treeUri, srcParentId), docUri(treeUri, destParentId))
      ?: throw VaultFsException("E_MOVE", "Déplacement refusé")
    return DocumentsContract.getDocumentId(moved)
  }

  private fun parentAndChild(treeUri: Uri, relPath: String): Pair<String, Child> {
    val segments = segmentsOf(relPath)
    if (segments.isEmpty()) throw VaultFsException("E_PATH", "Impossible d'agir sur la racine du coffre")
    var current = rootDocId(treeUri)
    for (segment in segments.dropLast(1)) {
      current = findChild(treeUri, current, segment)?.docId ?: throw VaultFsException("E_NOT_FOUND", "Introuvable : $relPath")
    }
    val child = findChild(treeUri, current, segments.last()) ?: throw VaultFsException("E_NOT_FOUND", "Introuvable : $relPath")
    return current to child
  }

  // Déplace vers .trash/<horodatage>-<nom> (ou détruit si permanent / déjà dans .trash).
  fun deleteFile(treeUri: Uri, relPath: String, permanent: Boolean, stamp: String): String? {
    val norm = normalizeRelPath(relPath)
    val (parentId, child) = parentAndChild(treeUri, norm)
    if (permanent || norm == TRASH_DIR || norm.startsWith("$TRASH_DIR/")) {
      if (!DocumentsContract.deleteDocument(resolver, docUri(treeUri, child.docId))) throw VaultFsException("E_DELETE", "Suppression refusée")
      return null
    }
    val trashId = mkdirs(treeUri, TRASH_DIR)
    val trashName = "$stamp-${child.name}"
    // moveDocument (API 24+) puis renommage horodaté ; repli copie vérifiée + suppression (fichiers).
    try {
      val movedId = moveDoc(treeUri, child, parentId, trashId)
      val finalId = tryRename(treeUri, movedId, trashName) ?: movedId
      val info = queryOne(treeUri, finalId)
      return "$TRASH_DIR/${info?.name ?: child.name}"
    } catch (e: Exception) {
      if (child.isDir) throw VaultFsException("E_TRASH", "Mise à la corbeille du dossier impossible : ${e.message}")
      val bytes = readBytes(treeUri, child.docId)
      val res = writeFileAtomic(treeUri, "$TRASH_DIR/$trashName", bytes)
      if (!DocumentsContract.deleteDocument(resolver, docUri(treeUri, child.docId))) throw VaultFsException("E_DELETE", "Copie en corbeille faite mais suppression refusée")
      return res.relPath
    }
  }

  fun rename(treeUri: Uri, relPath: String, newName: String): String {
    if (newName.contains('/') || newName.isBlank()) throw VaultFsException("E_NAME", "Nom invalide : $newName")
    val norm = normalizeRelPath(relPath)
    val (parentId, child) = parentAndChild(treeUri, norm)
    if (sameName(child.name, newName)) return norm
    if (findChild(treeUri, parentId, newName) != null) throw VaultFsException("E_EXISTS", "« $newName » existe déjà")
    val newId = tryRename(treeUri, child.docId, newName) ?: throw VaultFsException("E_RENAME", "Renommage refusé par le fournisseur")
    val info = queryOne(treeUri, newId)
    if (info == null || !sameName(info.name, newName)) {
      info?.let { tryRename(treeUri, it.docId, child.name) }
      throw VaultFsException("E_NAME", "Nom non représentable sur cet appareil : « $newName »")
    }
    val parentRel = norm.substringBeforeLast('/', "")
    return if (parentRel.isEmpty()) info.name else "$parentRel/${info.name}"
  }

  fun move(treeUri: Uri, relPath: String, destParentRelPath: String): String {
    val norm = normalizeRelPath(relPath)
    val destNorm = normalizeRelPath(destParentRelPath)
    if (destNorm == norm || destNorm.startsWith("$norm/")) throw VaultFsException("E_MOVE", "Impossible de déplacer un dossier dans lui-même")
    val (parentId, child) = parentAndChild(treeUri, norm)
    val destId = mkdirs(treeUri, destNorm)
    if (findChild(treeUri, destId, child.name) != null) throw VaultFsException("E_EXISTS", "« ${child.name} » existe déjà dans la destination")
    val target = if (destNorm.isEmpty()) child.name else "$destNorm/${child.name}"
    try {
      moveDoc(treeUri, child, parentId, destId)
    } catch (e: Exception) {
      if (child.isDir) throw VaultFsException("E_MOVE", "Déplacement du dossier refusé : ${e.message}")
      writeFileAtomic(treeUri, target, readBytes(treeUri, child.docId))
      DocumentsContract.deleteDocument(resolver, docUri(treeUri, child.docId))
    }
    return target
  }
}
